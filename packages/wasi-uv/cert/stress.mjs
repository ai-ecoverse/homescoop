/**
 * homescoop#1287's stress row for uv (0.13.1-3): `uv pip install` of 40
 * local wheels (60 modules each, plus a package needing all of them) into a
 * fresh venv, 6 times, with SLICC_WASM_BACKTRACE=1 and no cache. uv
 * resolves, unzips and links on threads, allocating while the shared memory
 * grows: V8 could trap a memset into a fresh block (stale per-thread memory
 * length, slicc-kernel#1172). 0006 (the allocator refresh) and the initial
 * heap (recipe.yaml wasm) must give 0 traps. Each round also records the
 * wasm memory size (VmSize from /proc/<pid>/status, polled with bash
 * builtins).
 */
import { createHash } from 'node:crypto';

// A stored (uncompressed) zip: enough for a wheel.
function crc32 (buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function zip (files) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name);
    const d = Buffer.from(text);
    const crc = crc32(d);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, d);
    central.push(c, n);
    off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
function wheel (name, requires, modules) {
  const di = `${name}-1.0.dist-info`;
  const files = [];
  for (let i = 0; i < modules; i++) files.push([`${name}/m${i}.py`, `# ${name} module ${i}\n` + `X${i} = ${JSON.stringify('x'.repeat(200))}\n`.repeat(20)]);
  files.push([`${name}/__init__.py`, '']);
  files.push([`${di}/METADATA`, `Metadata-Version: 2.1\nName: ${name}\nVersion: 1.0\n${requires.map((r) => `Requires-Dist: ${r}\n`).join('')}`]);
  files.push([`${di}/WHEEL`, 'Wheel-Version: 1.0\nGenerator: homescoop-stress\nRoot-Is-Purelib: true\nTag: py3-none-any\n']);
  const record = files.map(([n, t]) => `${n},sha256=${createHash('sha256').update(t).digest('base64url')},${Buffer.byteLength(t)}`);
  files.push([`${di}/RECORD`, record.join('\n') + `\n${di}/RECORD,,\n`]);
  return zip(files);
}

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvs.toml', SLICC_WASM_BACKTRACE: '1' };
  const ok = async (script, cwd = '/home') => {
    const r = await run(['bash', '-c', script], { cwd, env });
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };
  await ok('mkdir -p /home/sdists /home/s');
  const deps = [];
  for (let i = 0; i < 40; i++) {
    const name = `stressdep${i}`;
    deps.push(name);
    await write(`/home/sdists/${name}-1.0-py3-none-any.whl.b64`, wheel(name, [], 60).toString('base64'));
  }
  await write('/home/sdists/stressall-1.0-py3-none-any.whl.b64', wheel('stressall', deps, 1).toString('base64'));
  await ok('for f in *.b64; do base64 -d "$f" > "${f%.b64}" && rm "$f"; done', '/home/sdists');
  await write('/home/uvs.toml', 'no-index = true\nfind-links = ["/home/sdists"]\n');
  const script = [
    'rm -rf .venv && uv venv -q || exit 9',
    'uv pip install --no-cache stressall >/tmp/uv-out 2>/tmp/uv-err & pid=$!; m=0',
    'while kill -0 $pid 2>/dev/null; do',
    '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
    'done; wait $pid; rc=$?',
    't=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/uv-err',
    'n=0; for d in .venv/lib/python*/site-packages/stressdep*/; do [ -f "$d/m59.py" ] && n=$((n+1)); done',
    'echo "rc=$rc peak_kb=$m traps=$t installed=$n"',
  ].join('\n');
  let traps = 0;
  let peak = 0;
  for (let round = 1; round <= 6; round++) {
    const r = await run(['bash', '-c', script], { cwd: '/home/s', env });
    const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+) installed=(\d+)/.exec(r.stdout) ?? [];
    traps += Number(m[3] ?? 1);
    peak = Math.max(peak, Number(m[2] ?? 0));
    assert.equal(Number(m[1]), 0, `round ${round}: uv pip install: ${r.stdout} ${r.stderr}`);
    assert.equal(Number(m[4]), 40, `round ${round}: all 40 packages installed: ${r.stdout}`);
  }
  console.log(`stress: 6 × uv pip install of 41 local wheels (2,400 modules): ${traps} traps, peak ${Math.round(peak / 1024)} MiB`);
  assert.equal(traps, 0, 'no wasm trap in 6 rounds');
  const limit = Number(process.env.UV_STRESS_INITIAL_MIB || 64) * 1024;
  assert.ok(peak > 0 && peak <= limit, `the wasm memory stays within the initial heap (peak ${peak} kB, limit ${limit} kB)`);
}
