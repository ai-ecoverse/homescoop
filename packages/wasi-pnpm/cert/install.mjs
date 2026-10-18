/**
 * wasi-pnpm (homescoop#478) in slicc-kernel in Chromium, under users
 * enforce. It runs pnpm, pn and the npm shim, and npm run of a package
 * script. An install of 30 packages from a ctx.serve registry runs three
 * times with SLICC_WASM_THREADS=256 (the package's env) and must never trap.
 * Two users: bob's install in his home works, alice can't write into bob's
 * node_modules or store, and her own install works. Finally, pnpm.wasm
 * doesn't link parking_lot_core's panicking parker (patch 0001: without it
 * a contended lock traps `unreachable`) and carries no build path (patch
 * 0002, homescoop#522).
 */
import { createHash } from 'node:crypto';
import { tarball } from '../test/fixtures/registry.mjs';

const REGISTRY = 'http://registry.test/';
const N = 30;
const name = (i) => `dep-${String(i).padStart(2, '0')}`;
const packages = {};
for (let i = 0; i < N; i++) {
  // Every third package depends on the next, so the graph has depth too.
  const dependencies = i % 3 === 0 && i + 1 < N ? { [name(i + 1)]: '^1.0.0' } : {};
  const manifest = { name: name(i), version: '1.0.0', main: 'index.js', dependencies };
  const tgz = tarball({ 'package.json': JSON.stringify(manifest), 'index.js': `module.exports = ${i};\n` });
  packages[name(i)] = {
    manifest,
    tgz: tgz.toString('base64'),
    integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}`,
  };
}

// Self-contained: ctx.serve evaluates the source in the page.
const registry = {
  toString: () => `(req) => {
    const PACKAGES = ${JSON.stringify(packages)};
    const BASE = ${JSON.stringify(REGISTRY)};
    const u = new URL(req.url);
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    const path = decodeURIComponent(u.pathname.slice(1));
    const file = /^([^/]+)\\/-\\/[^/]+-1\\.0\\.0\\.tgz$/.exec(path);
    if (file && PACKAGES[file[1]]) {
      const bin = atob(PACKAGES[file[1]].tgz);
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    const pkg = PACKAGES[path];
    if (!pkg) return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
    const packument = {
      name: path,
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { ...pkg.manifest, dist: { tarball: BASE + path + '/-/' + path + '-1.0.0.tgz', integrity: pkg.integrity } } },
    };
    return { headers: [['content-type', 'application/json']], body: JSON.stringify(packument) };
  }`,
};

export default async function (ctx) {
  const { run, write, read, assert, addUser, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;
  const TRAP = /wasm trap|unreachable|panicked|RuntimeError/;

  for (const cmd of ['pnpm', 'pn']) {
    const v = await run([cmd, '--version'], { cwd: '/tmp' });
    assert.equal(v.status, 0, `${cmd}: ${out(v)}`);
    assert.equal(v.stdout, '12.9.1\n', `${cmd}: ${out(v)}`);
  }
  const npmV = await run(['npm', '-v'], { cwd: '/tmp' });
  assert.equal(npmV.status, 0, out(npmV));
  assert.match(npmV.stdout, /^12\.9\.1$/m, out(npmV));

  await serve(registry);
  await addUser({ name: 'bob' });
  await addUser({ name: 'alice' });
  const app = (home) => ({
    name: 'app',
    version: '1.0.0',
    private: true,
    scripts: { hello: 'echo hello-from-script' },
    dependencies: Object.fromEntries(Array.from({ length: N }, (_, i) => [name(i), '^1.0.0'])),
  });

  // bob installs 30 packages three times over, from an empty node_modules.
  await write('/home/bob/app/package.json', JSON.stringify(app('/home/bob')));
  for (let round = 1; round <= 3; round++) {
    const r = await run(['bash', '-c', `rm -rf node_modules pnpm-lock.yaml && pnpm install --registry ${REGISTRY}`], { cwd: '/home/bob/app', user: 'bob' });
    assert.equal(r.status, 0, `install round ${round}: ${out(r)}`);
    assert.doesNotMatch(r.stdout + r.stderr, TRAP, `install round ${round}: ${out(r)}`);
    for (const i of [0, 1, 17, N - 1]) {
      assert.equal(await read(`/home/bob/app/node_modules/${name(i)}/index.js`), `module.exports = ${i};\n`, `round ${round}: ${name(i)}`);
    }
  }
  const lock = await read('/home/bob/app/pnpm-lock.yaml');
  assert.match(lock ?? '', /dep-29@1\.0\.0/);

  // npm run through the shim (sh → pnpm run).
  const script = await run(['npm', 'run', 'hello'], { cwd: '/home/bob/app', user: 'bob' });
  assert.equal(script.status, 0, out(script));
  assert.match(script.stdout, /^hello-from-script$/m, out(script));

  // alice can't change bob's node_modules or his store.
  const store = await run(['pnpm', 'store', 'path'], { cwd: '/home/bob/app', user: 'bob' });
  assert.equal(store.status, 0, out(store));
  const storePath = store.stdout.trim();
  assert.ok(storePath.startsWith('/home/bob/'), `bob's store is in his home: ${storePath}`);
  for (const target of ['/home/bob/app/node_modules/dep-00/index.js', `${storePath}/alice-was-here`]) {
    const w = await run(['bash', '-c', `echo tampered > '${target}'`], { cwd: '/home/alice', user: 'alice' });
    assert.notEqual(w.status, 0, `alice wrote ${target}: ${out(w)}`);
    assert.match(w.stderr, /Permission denied/, out(w));
  }
  assert.equal(await read('/home/bob/app/node_modules/dep-00/index.js'), 'module.exports = 0;\n');

  // alice's own install, with her own store.
  await write('/home/alice/app/package.json', JSON.stringify(app('/home/alice')));
  const mine = await run(['pnpm', 'install', '--registry', REGISTRY], { cwd: '/home/alice/app', user: 'alice' });
  assert.equal(mine.status, 0, out(mine));
  assert.doesNotMatch(mine.stdout + mine.stderr, TRAP, out(mine));
  assert.equal(await read(`/home/alice/app/node_modules/${name(N - 1)}/index.js`), `module.exports = ${N - 1};\n`);

  const wasm = await read('/node_modules/@ai-ecoverse/wasi-pnpm/bin/pnpm.wasm');
  assert.ok(wasm && wasm.length > 1_000_000, 'pnpm.wasm is installed');
  // 0001: parking_lot_core's panicking wasm parker is not linked in. (The
  // installs above don't make a lock park in this harness, with or without
  // 0001: NEGATIVE.md.)
  assert.ok(!wasm.includes('Parking not supported on this platform'), "pnpm.wasm links parking_lot_core's panicking wasm parker (0001 missing)");
  // homescoop#522: no build path in pnpm.wasm (0002; 12.9.1-8 carried
  // /home/runner/work/_temp/homescoop-work/pnpm-<commit>/pnpm/crates/cli).
  for (const path of ['/home/runner', '/tmp/homescoop-work', 'homescoop-work/pnpm-']) {
    assert.ok(!wasm.includes(path), `pnpm.wasm contains a build path (${JSON.stringify(path)})`);
  }

  // 12.9.1-10: pnpm.wasm has no name section, and bin/pnpm.wasm.names names
  // every function at pnpm.wasm's index (the exports check the shift), so
  // SLICC names a trap's frames under SLICC_WASM_BACKTRACE=1.
  const bytes = await ctx.readBytes('/node_modules/@ai-ecoverse/wasi-pnpm/bin/pnpm.wasm');
  const names = (await ctx.readBytes('/node_modules/@ai-ecoverse/wasi-pnpm/bin/pnpm.wasm.names')) ?? Buffer.alloc(0);
  assert.ok(names.length > 1_000_000, 'bin/pnpm.wasm.names is installed (12.9.1-9: none)');
  const mod = new WebAssembly.Module(bytes);
  assert.equal(WebAssembly.Module.customSections(mod, 'name').length, 0, 'pnpm.wasm has no name section of its own (12.9.1-9: generated names only)');
  const leb = (b, at) => { let v = 0, s = 0, x; do { x = b[at++]; v += (x & 127) * 2 ** s; s += 7; } while (x & 128); return [v, at]; };
  const fnames = new Map();
  for (let at = 0; at < names.length;) {
    const id = names[at];
    const [size, body] = leb(names, at + 1);
    if (id === 1) {
      let [count, p] = leb(names, body);
      for (; count > 0; count--) {
        let index, n;
        [index, p] = leb(names, p);
        [n, p] = leb(names, p);
        fnames.set(index, names.toString('utf8', p, p + n));
        p += n;
      }
    }
    at = body + size;
  }
  const imported = WebAssembly.Module.imports(mod).filter((i) => i.kind === 'function').length;
  let defined = 0;
  for (let at = 8; at < bytes.length;) {
    const [size, body] = leb(bytes, at + 1);
    if (bytes[at] === 3) [defined] = leb(bytes, body);
    at = body + size;
  }
  assert.equal(fnames.size, imported + defined, `pnpm.wasm.names names every function once (${fnames.size} names, ${imported} + ${defined} functions)`);
  assert.equal(fnames.size ? Math.max(...fnames.keys()) : -1, imported + defined - 1, 'the highest named index is the last function');
  assert.equal(fnames.get(0), 'pnpm_atomic.wait32', "index 0 is build.mjs's pnpm_atomic.wait32 import");
  assert.ok([...fnames.values()].filter((n) => /tokio/.test(n)).length > 1000, 'the Rust symbols (tokio) are there');
  const exportIndex = (field) => {
    // export section: name, kind 0 (function), index
    for (let at = 8; at < bytes.length;) {
      const [size, body] = leb(bytes, at + 1);
      if (bytes[at] === 7) {
        let [count, p] = leb(bytes, body);
        for (; count > 0; count--) {
          let n, index;
          [n, p] = leb(bytes, p);
          const f = bytes.toString('utf8', p, p + n);
          p += n;
          const kind = bytes[p++];
          [index, p] = leb(bytes, p);
          if (kind === 0 && f === field) return index;
        }
      }
      at = body + size;
    }
    return undefined;
  };
  for (const f of ['_start', 'malloc', 'free', 'wasi_thread_start']) {
    assert.equal(fnames.get(exportIndex(f)), f, `the export ${f} carries its own name in pnpm.wasm.names`);
  }
}
