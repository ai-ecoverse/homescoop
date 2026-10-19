/**
 * File modes after an install (12.9.1-12, patches/0005). The wasm port now
 * skips re-checking (fstat) and re-applying (fchmod) a created file's mode
 * once it has seen the kernel apply creation modes, and when the umask
 * clears none of the mode's bits; it also looks up each store shard's mode
 * once per run. Modes must come out the same: bob installs tool@1.0.0 (an
 * executable bin/tool, 0755 in the tarball, and a plain lib/a.js) under
 * umask 022, then into a second project under umask 077. node_modules gets
 * 755/644, then 700 (711 after bin linking)/600, and the store's files are 755/644 (written under
 * 022, an -exec name for the executable).
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const REGISTRY = 'http://registry.test/';

function header(name, size, mode) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}
function tarball(files) {
  const parts = [];
  for (const [name, [content, mode]] of Object.entries(files)) {
    const data = Buffer.from(content);
    parts.push(header(`package/${name}`, data.length, mode), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
const manifest = { name: 'tool', version: '1.0.0', bin: { tool: 'bin/tool' } };
const tgz = tarball({
  'package.json': [JSON.stringify(manifest), 0o644],
  'bin/tool': ['#!/bin/sh\necho tool-ran\n', 0o755],
  'lib/a.js': ['module.exports = 1;\n', 0o644],
});
const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
const registry = {
  toString: () => `(req) => {
    const u = new URL(req.url);
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    if (u.pathname === '/tool/-/tool-1.0.0.tgz') {
      const bin = atob(${JSON.stringify(tgz.toString('base64'))});
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    if (u.pathname === '/tool') {
      return { headers: [['content-type', 'application/json']], body: JSON.stringify({ name: 'tool', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { ...${JSON.stringify(manifest)}, dist: { tarball: ${JSON.stringify(REGISTRY)} + 'tool/-/tool-1.0.0.tgz', integrity: ${JSON.stringify(integrity)} } } } }) };
    }
    return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
  }`,
};

export default async function (ctx) {
  const { run, write, assert, addUser, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-2000)}\n--- stderr\n${r.stderr.slice(-2000)}`;
  await serve(registry);
  await addUser({ name: 'bob' });
  // bin/tool under 077 is 711: pnpm's bin linking adds the execute bits
  // (mode | 0o111) without the umask, on every platform; no read or write
  // for group or others, which is what the umask is for.
  for (const [dir, mask, bin, lib] of [['m022', '022', '755', '644'], ['m077', '077', '7[01][01]', '600']]) {
    await write(`/home/bob/${dir}/package.json`, JSON.stringify({ name: dir, version: '1.0.0', private: true, dependencies: { tool: '1.0.0' } }));
    await run(['chown', '-R', 'bob', `/home/bob/${dir}`], { cwd: '/' });
    const r = await run(['bash', '-c', `umask ${mask}; pnpm install --registry ${REGISTRY} && stat -c '%a %n' node_modules/tool/bin/tool node_modules/tool/lib/a.js node_modules/tool/package.json`], { cwd: `/home/bob/${dir}`, user: 'bob' });
    assert.equal(r.status, 0, `install under umask ${mask}: ${out(r)}`);
    assert.match(r.stdout, new RegExp(`^${bin} node_modules/tool/bin/tool$`, 'm'), `umask ${mask}: bin/tool is ${bin}: ${out(r)}`);
    assert.match(r.stdout, new RegExp(`^${lib} node_modules/tool/lib/a\\.js$`, 'm'), `umask ${mask}: lib/a.js is ${lib}: ${out(r)}`);
    assert.match(r.stdout, new RegExp(`^${lib} node_modules/tool/package\\.json$`, 'm'), `umask ${mask}: package.json is ${lib}: ${out(r)}`);
    const t = await run(['bash', '-c', 'node_modules/.bin/tool || node_modules/tool/bin/tool'], { cwd: `/home/bob/${dir}`, user: 'bob' });
    assert.match(t.stdout, /^tool-ran$/m, `umask ${mask}: the bin runs: ${out(t)}`);
  }
  // The store, written under umask 022 by the first install.
  const s = await run(['bash', '-c', 'shopt -s nullglob globstar; store=$(pnpm store path); for f in "$store"/files/**/*; do if [[ -f $f ]]; then stat -c "%a %n" "$f"; fi; done'], { cwd: '/home/bob/m022', user: 'bob' });
  assert.equal(s.status, 0, out(s));
  const lines = s.stdout.split('\n').filter((l) => /\/files\//.test(l));
  const exec = lines.filter((l) => /-exec$/.test(l));
  const plain = lines.filter((l) => !/-exec$/.test(l) && !/-index\.json$|\/index\//.test(l));
  assert.ok(exec.length >= 1 && exec.every((l) => l.startsWith('755 ')), `store: the -exec file is 755: ${exec.join(' | ')}`);
  assert.ok(plain.length >= 2 && plain.every((l) => l.startsWith('644 ')), `store: plain files are 644: ${plain.slice(0, 6).join(' | ')}`);
  console.log(`modes: umask 022 → 755/644, 077 → 7x0/600; store ${exec.length} exec at 755, ${plain.length} plain at 644`);
}
