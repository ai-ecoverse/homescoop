import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'recipe.yaml'), 'utf8');
const MIB = 1024 * 1024;
const G = '/root/gh';
const B = '/root/gh-src';
const R = '/tmp/gh';
const P = 'gpg --batch --pinentry-mode loopback --passphrase ""';
const NAMES = ['gpg', 'gpg-agent'];

function jobs(phase, round) {
  const out = {};
  const tag = `${phase}${round}`;
  const many = phase === 'burst' ? [1, 2, 3, 4, 5] : [1];
  out.keygen = `${P} --quick-gen-key "H${tag}k <h${tag}k@example.org>" default default never`;
  out.rsa = `${P} --quick-gen-key "H${tag}rsa <h${tag}rsa@example.org>" rsa3072 sign never`;
  out.import = `gpg --batch --yes --delete-secret-and-public-key "$(cat ${R}/src.fpr)" 2>/dev/null; ${P} --import ${R}/src.sec`;
  for (const i of many) out[`sign${i}`] = `${P} --yes -u main@example.org -o ${R}/s${i}.sig --detach-sign ${R}/data`;
  for (const i of many) out[`decrypt${i}`] = `${P} --yes -o ${R}/d${i} -d ${R}/ref.gpg`;
  for (const i of [1, 2]) out[`verify${i}`] = `gpg --batch --verify ${R}/ref.sig ${R}/data`;
  out.gpgv = `gpgv --keyring ${R}/pub.gpg ${R}/ref.sig ${R}/data`;
  for (const i of [1, 2]) out[`encrypt${i}`] = `gpg --batch --yes --trust-model always -r main@example.org -o ${R}/e${i}.gpg -e ${R}/data`;
  return out;
}

function roundScript(work, measure) {
  const names = Object.keys(work);
  return [
    `cd ${R}; rm -rf *.rc *.out *.err p; mkdir p`,
    ...names.map((n) => `( (${measure ? `export HOMESCOOP_WASM_PEAK=${R}/p/${n}.peak; ` : ''}${work[n]}) >${n}.out 2>${n}.err </dev/null; echo $? > ${n}.rc ) &`),
    'declare -A vm; b=; while read -r k v u; do [ "$k" = VmSize: ] && b=$v; done < /proc/$$/status',
    `while [ "$(ls *.rc 2>/dev/null | wc -l)" -lt ${names.length} ]; do`,
    '  for s in /proc/[0-9]*/status; do n=; while read -r k v u; do case $k in Name:) n=$v;; VmSize:) case $n in gpg|gpgv|gpg-agent) [ "$v" = "$b" ] || { [ "${vm[$n]:-0}" -lt "$v" ] && vm[$n]=$v; };; esac;; esac; done < $s 2>/dev/null; done',
    'done; wait',
    `for n in ${names.join(' ')}; do t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*RuntimeError*|*unreachable*) t=$((t+1));; esac; done < $n.err; pk=; [ -s p/$n.peak ] && read -r pk < p/$n.peak; echo "job $n rc=$(cat $n.rc) traps=$t peak=$pk"; done`,
    `a=$(gpg-connect-agent "getinfo pid" /bye | while read -r d p; do [ "$d" = D ] && echo $p; done); echo "agent pid=$a"`,
    'while read -r k v u; do [ "$k" = VmSize: ] && vm[gpg-agent-end]=$v; [ "$k" = Threads: ] && echo "agent threads=$v"; done < /proc/$a/status',
    'for n in "${!vm[@]}"; do echo "vm $n ${vm[$n]}"; done',
    'pk=; [ -s agent.peak ] && read -r pk < agent.peak; echo "agent peak=$pk"',
  ].join('\n');
}

export default async function heap(ctx) {
  const { run, assert } = ctx;
  const measure = process.env.WASIX_GNUPG_HEAP_MEASURE === '1';
  const initialMiB = Number(/^wasm:\n(?:  .*\n)*?  initial-memory: (\d+)MiB$/m.exec(recipe)?.[1]);
  if (!measure) assert.ok(initialMiB > 0, 'recipe.yaml has wasm.initial-memory in MiB (homescoop#1879)');
  const sh = async (script, home = G) => {
    const r = await run(['bash', '-c', `export GNUPGHOME=${home} SLICC_WASM_BACKTRACE=1; ${script}`], { cwd: '/tmp' });
    assert.equal(r.status, 0, `rc=${r.status}\n${script}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  await sh(`rm -rf ${G} ${B} ${R}; mkdir -m 700 -p ${G} ${B}; mkdir -p ${R}; head -c ${4 * MIB} /dev/urandom > ${R}/data`);
  await sh(`${P} --quick-gen-key "Src <src@example.org>" default default never && gpg --with-colons -k src@example.org | while IFS=: read -r t _ _ _ _ _ _ _ _ f _; do [ "$t" = fpr ] && { echo $f; break; }; done > ${R}/src.fpr && ${P} --armor --export-secret-keys src@example.org > ${R}/src.sec && gpgconf --kill gpg-agent`, B);
  await sh(`${measure ? `HOMESCOOP_WASM_PEAK=${R}/agent.peak ` : ''}gpg-connect-agent /bye && ${P} --quick-gen-key "Main <main@example.org>" default default never && gpg --export main@example.org > ${R}/pub.gpg && ${P} -u main@example.org -o ${R}/ref.sig --detach-sign ${R}/data && gpg --batch --trust-model always -r main@example.org -o ${R}/ref.gpg -e ${R}/data`);
  const agent0 = /^agent pid=(\d+)$/m.exec(await sh(`echo "agent pid=$(gpg-connect-agent "getinfo pid" /bye | while read -r d p; do [ "$d" = D ] && echo $p; done)"`))?.[1];
  assert.ok(agent0, 'gpg-agent runs');
  const rounds = measure ? 2 : 3;
  const mib = (b) => Math.round((b / MIB) * 10) / 10;
  const kb = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, mib(v * 1024)])));
  const by = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, mib(v)])));
  let traps = 0;
  const seen = {};
  for (const phase of ['sized', 'burst']) {
    const peaks = {};
    const vms = {};
    let threads = 0;
    for (let round = 1; round <= rounds; round++) {
      const work = jobs(phase, round);
      const at = `${phase} round ${round}`;
      const out = await sh(roundScript(work, measure));
      for (const n of Object.keys(work)) {
        const m = new RegExp(`^job ${n} rc=(\\d+) traps=(\\d+) peak=(\\d*) ?(\\d*)$`, 'm').exec(out) ?? [];
        assert.equal(m[1], '0', `${at} ${n} (${work[n]}): ${out}\n${(await sh(`cat ${R}/${n}.err`)).slice(-2000)}`);
        traps += Number(m[2] ?? 1);
        const kind = n.replace(/\d+$/, '');
        if (m[3]) peaks[kind] = Math.max(peaks[kind] ?? 0, Number(m[3]));
      }
      assert.equal(/^agent pid=(\d+)$/m.exec(out)?.[1], agent0, `${at}: the same gpg-agent still answers (no trap or crash): ${out}`);
      threads = Math.max(threads, Number(/^agent threads=(\d+)$/m.exec(out)?.[1] ?? 0));
      const ap = /^agent peak=(\d*)/m.exec(out)?.[1];
      if (ap) peaks['gpg-agent'] = Math.max(peaks['gpg-agent'] ?? 0, Number(ap));
      for (const [, n, v] of out.matchAll(/^vm (\S+) (\d+)$/gm)) vms[n] = Math.max(vms[n] ?? 0, Number(v));
      const signs = Object.keys(work).filter((n) => /^sign\d+$/.test(n)).map((n) => n.slice(4));
      const check = await sh([
        `cd ${R}`,
        `for i in ${signs.join(' ')}; do gpg --batch --verify s$i.sig data 2>&1 | while IFS= read -r l; do case $l in *"Good signature"*) echo "sig$i good";; esac; done; done`,
        'h=$(sha256sum < data)',
        `for i in ${signs.join(' ')}; do [ "$(sha256sum < d$i)" = "$h" ] && echo "dec$i same"; done`,
        `for i in 1 2; do [ "$(${P} -o - -d e$i.gpg 2>/dev/null | sha256sum)" = "$h" ] && echo "enc$i round"; done`,
        `gpg --with-colons -k | while IFS=: read -r t _ _ _ _ _ _ _ _ u _; do [ "$t" = uid ] && echo "uid $u"; done`,
        'gpg --with-colons -K src@example.org | while IFS=: read -r t _; do [ "$t" = sec ] && echo "src secret"; done',
        'true',
      ].join('\n'));
      for (const i of signs) assert.match(check, new RegExp(`^sig${i} good$`, 'm'), `${at} sign${i}: ${check}`);
      for (const i of signs) assert.match(check, new RegExp(`^dec${i} same$`, 'm'), `${at} decrypt${i}: ${check}`);
      for (const i of [1, 2]) assert.match(check, new RegExp(`^enc${i} round$`, 'm'), `${at} encrypt${i}: ${check}`);
      for (const k of ['k', 'rsa']) assert.match(check, new RegExp(`^uid H${phase}${round}${k} <h${phase}${round}${k}@example\\.org>$`, 'm'), `${at} keygen ${k}: ${check}`);
      assert.match(check, /^src secret$/m, `${at} import: ${check}`);
    }
    const agentUsers = Object.keys(jobs(phase, 1)).filter((n) => /^(keygen|rsa|import|sign|decrypt)/.test(n)).length;
    console.log(`heap ${phase}: ${rounds} rounds of ${Object.keys(jobs(phase, 1)).length} concurrent gpg/gpgv runs, ${agentUsers} of them through gpg-agent (pid ${agent0}, Threads up to ${threads}): VmSize peak MiB ${kb(vms)}; malloc heap end MiB ${by(peaks)}`);
    seen[phase] = vms;
  }
  await sh('gpgconf --kill gpg-agent');
  console.log(`heap: ${traps} wasm traps in ${2 * rounds} rounds`);
  assert.equal(traps, 0, 'no wasm trap (slicc-kernel#1172, homescoop#1879)');
  if (measure) return;
  for (const n of NAMES) {
    assert.ok(seen.sized[n] > 0, `sized: ${n}'s VmSize was read from /proc/<pid>/status`);
    assert.equal(seen.sized[n], initialMiB * 1024, `sized: ${n}'s wasm memory stays at the ${initialMiB} MiB initial heap, so it never calls memory.grow (recipe.yaml wasm, wasix-sysroot -43's malloc uses the initial pages; homescoop#1879, #1287): VmSize peak ${seen.sized[n]} kB`);
  }
  assert.equal(seen.sized['gpg-agent-end'], initialMiB * 1024, `sized: gpg-agent's VmSize after ${rounds} rounds is the initial heap: ${seen.sized['gpg-agent-end']} kB`);
  assert.ok(seen.burst['gpg-agent-end'] > initialMiB * 1024, `burst: gpg-agent grows past the initial heap (8 MiB of thread stack per connection), so the rounds ran on grown memory under the allocator refresh: ${seen.burst['gpg-agent-end']} kB`);
}
