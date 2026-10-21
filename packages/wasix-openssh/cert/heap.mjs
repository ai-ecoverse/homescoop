import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'recipe.yaml'), 'utf8');
const MIB = 1024 * 1024;
const DOWN = 50 * MIB;
const ZEROS = createHash('sha256').update(Buffer.alloc(DOWN)).digest('hex');

function poll(name, cmd) {
  return [
    `rm -f /tmp/hp/${name}.peak`,
    `(HOMESCOOP_WASM_PEAK=/tmp/hp/${name}.peak SLICC_WASM_BACKTRACE=1 ${cmd}) 2>/tmp/hp/${name}.err & pid=$!; m=0; declare -A last; b=; while read -r k v u; do [ "$k" = VmSize: ] && b=$v; done < /proc/$$/status`,
    'while kill -0 $pid 2>/dev/null; do',
    '  for s in /proc/[0-9]*/status; do n=; p=${s#/proc/}; p=${p%/status}; while read -r k v u; do case $k in Name:) n=$v;; VmSize:) case $n in ssh|ssh-keygen|scp|sftp) [ "$v" = "$b" ] || last[$p]=$v;; esac;; esac; done < $s 2>/dev/null; done',
    'done; wait $pid; rc=$?; for v in "${last[@]}"; do [ "$v" -gt "$m" ] && m=$v; done',
    `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*RuntimeError*) t=$((t+1));; esac; done < /tmp/hp/${name}.err`,
    `pk=; [ -s /tmp/hp/${name}.peak ] && read -r pk < /tmp/hp/${name}.peak`,
    `echo "${name} rc=$rc vm_kb=$m traps=$t peak=$pk"; [ $rc = 0 ] || tail -5 /tmp/hp/${name}.err`,
  ].join('\n');
}

export default async function heap(ctx) {
  const { run, assert, hostXfer } = ctx;
  const measure = process.env.WASIX_OPENSSH_HEAP_MEASURE === '1';
  const initialMiB = Number(/^wasm:\n(?:  .*\n)*?  initial-memory: (\d+)MiB$/m.exec(recipe)?.[1]);
  if (!measure) assert.ok(initialMiB > 0, 'recipe.yaml has wasm.initial-memory in MiB (homescoop#1425)');
  const host = 'sshd.cert.internal';
  const o = '-o BatchMode=yes';
  const work = {
    keygen: `rm -f /tmp/hp/k_rsa /tmp/hp/k_rsa.pub; ssh-keygen -q -t rsa -b 4096 -N '' -f /tmp/hp/k_rsa </dev/null`,
    down: `ssh ${o} ${host} 'head -c ${DOWN} /dev/zero' >/tmp/hp/down`,
    downc: `ssh ${o} -C ${host} 'head -c ${DOWN} /dev/zero' >/tmp/hp/downc`,
    up: `ssh ${o} ${host} 'wc -c' </tmp/hp/down >/tmp/hp/up`,
    scp: `scp -q ${o} /tmp/hp/down ${host}:${hostXfer}/heap.bin && scp -q ${o} ${host}:${hostXfer}/heap.bin /tmp/hp/scp`,
    sftp: `printf 'get ${hostXfer}/heap.bin /tmp/hp/sftp\\n' | sftp -q ${o} -b - ${host}`,
    kex: `ssh ${o} -o KexAlgorithms=mlkem768x25519-sha256 -o Ciphers=aes256-gcm@openssh.com ${host} true`,
  };
  const stats = {};
  let traps = 0;
  const rounds = measure ? 2 : 3;
  for (let round = 1; round <= rounds; round++) {
    for (const [name, cmd] of Object.entries(work)) {
      await run(['bash', '-c', `mkdir -p /tmp/hp; rm -f /tmp/hp/${name}`]);
      const r = await run(['bash', '-c', poll(name, cmd)]);
      const m = new RegExp(`^${name} rc=(\\d+) vm_kb=(\\d+) traps=(\\d+) peak=(\\d*) ?(\\d*)$`, 'm').exec(r.stdout) ?? [];
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${r.stderr}`);
      traps += Number(m[3] ?? 1);
      const s = (stats[name] ??= { vm: 0, heap: 0, mem: 0 });
      s.vm = Math.max(s.vm, Number(m[2] || 0));
      s.heap = Math.max(s.heap, Number(m[4] || 0));
      s.mem = Math.max(s.mem, Number(m[5] || 0));
    }
    const sums = await run(['bash', '-c', 'sha256sum /tmp/hp/down /tmp/hp/downc /tmp/hp/scp /tmp/hp/sftp; cat /tmp/hp/up; ssh-keygen -l -f /tmp/hp/k_rsa.pub']);
    for (const f of ['down', 'downc', 'scp', 'sftp']) assert.match(sums.stdout, new RegExp(`^${ZEROS}  /tmp/hp/${f}$`, 'm'), `round ${round} ${f}: ${sums.stdout}`);
    assert.match(sums.stdout, new RegExp(`^\\s*${DOWN}$`, 'm'), `round ${round} up: ${sums.stdout}`);
    assert.match(sums.stdout, /^4096 SHA256:/m, `round ${round} keygen: ${sums.stdout}`);
    await run(['bash', '-c', 'rm -f /tmp/hp/down /tmp/hp/downc /tmp/hp/scp /tmp/hp/sftp']);
  }
  const mib = (b) => Math.round((b / MIB) * 10) / 10;
  console.log(`heap: ${rounds} × ${Object.keys(work).join(', ')}: ${traps} traps; VmSize peak MiB ${JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, mib(v.vm * 1024)])))}; malloc heap end MiB ${JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${mib(v.heap)}/${mib(v.mem)}`])))}`);
  assert.equal(traps, 0, 'no wasm trap');
  if (measure) return;
  for (const [name, s] of Object.entries(stats)) {
    assert.ok(s.vm > 0, `${name}: VmSize was read from /proc/<pid>/status`);
    assert.equal(s.vm, initialMiB * 1024, `${name}: the wasm memory stays at the ${initialMiB} MiB initial heap, so it never calls memory.grow (recipe.yaml wasm, wasix-sysroot -40's malloc uses the initial pages; homescoop#1425, #1287): VmSize peak ${s.vm} kB`);
    if (s.mem) assert.ok(s.mem <= initialMiB * MIB, `${name}: malloc's memory size ${s.mem} is within the initial heap`);
  }
}
