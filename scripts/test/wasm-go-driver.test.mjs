import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const { default: goMain } = await import(new URL('../../packages/wasm-go/src/go.mjs', import.meta.url));

const TE = new TextEncoder();
const TD = new TextDecoder();
const PKG = '/nm/@ai-ecoverse/wasm-go';
const HOME = '/home/u';
const QUOTE_ZIP = readFileSync(new URL('fixtures/wasm-go/rsc.io-quote-v1.5.2.zip', import.meta.url));
const QUOTE_SUM = 'h1:w5fcysjrx7yqtD/aO+QwRjYZOKnaM9Uh2b40tElTs3Y=';

function norm(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });

class MemFS {
  constructor() {
    this.files = new Map();
    this.dirs = new Set(['/']);
  }

  mkdirSync(p) {
    const parts = norm(p).split('/').filter(Boolean);
    let at = '';
    for (const part of parts) {
      at += `/${part}`;
      if (this.files.has(at)) throw Object.assign(new Error(`ENOTDIR: ${at}`), { code: 'ENOTDIR' });
      this.dirs.add(at);
    }
  }

  writeSync(p, data) {
    const q = norm(p);
    const parent = q.slice(0, q.lastIndexOf('/')) || '/';
    if (!this.dirs.has(parent)) throw enoent(parent);
    this.files.set(q, typeof data === 'string' ? TE.encode(data) : new Uint8Array(data));
  }

  put(p, data) {
    const q = norm(p);
    this.mkdirSync(q.slice(0, q.lastIndexOf('/')) || '/');
    this.writeSync(q, data);
  }

  text(p) {
    const b = this.files.get(norm(p));
    return b === undefined ? undefined : TD.decode(b);
  }

  under(p) {
    const q = norm(p);
    return [...this.files.keys()].filter((k) => k === q || k.startsWith(`${q}/`));
  }

  async exists(p) {
    const q = norm(p);
    return this.files.has(q) || this.dirs.has(q);
  }

  async stat(p) {
    const q = norm(p);
    if (this.dirs.has(q)) return { isDirectory: true, isFile: false };
    if (this.files.has(q)) return { isDirectory: false, isFile: true, size: this.files.get(q).length };
    throw enoent(q);
  }

  async readFile(p) {
    const q = norm(p);
    if (!this.files.has(q)) throw enoent(q);
    return this.files.get(q).slice();
  }

  async readdir(p) {
    const q = norm(p);
    if (!this.dirs.has(q)) throw enoent(q);
    const base = q === '/' ? '/' : `${q}/`;
    const names = new Set();
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (k !== q && k.startsWith(base)) names.add(k.slice(base.length).split('/')[0]);
    }
    return [...names];
  }

  async mkdir(p) {
    this.mkdirSync(p);
  }

  async writeFile(p, data) {
    this.writeSync(p, data);
  }

  async rename(a, b) {
    const from = norm(a);
    const to = norm(b);
    if (this.files.has(to) || this.dirs.has(to)) throw Object.assign(new Error(`EEXIST: ${to}`), { code: 'EEXIST' });
    if (this.files.has(from)) {
      this.files.set(to, this.files.get(from));
      this.files.delete(from);
      return;
    }
    if (!this.dirs.has(from)) throw enoent(from);
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
    for (const [k, v] of [...this.files]) {
      if (k.startsWith(`${from}/`)) {
        this.files.delete(k);
        this.files.set(to + k.slice(from.length), v);
      }
    }
  }

  async rm(p) {
    const q = norm(p);
    this.files.delete(q);
    for (const k of [...this.files.keys()]) if (k.startsWith(`${q}/`)) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === q || d.startsWith(`${q}/`)) this.dirs.delete(d);
  }

  async chmod() {}
}

function world() {
  const fs = new MemFS();
  fs.put(`${PKG}/goroot/VERSION`, 'go1.27.4\ntime 2026-01-01\n');
  for (const t of ['compile', 'link', 'asm']) fs.put(`${PKG}/goroot/pkg/tool/wasip1_wasm/${t}`, '\0asm');
  fs.put(`${PKG}/goroot/pkg/include/textflag.h`, '');
  const std = '/nm/@ai-ecoverse/wasm-go-std-wasip1';
  fs.put(`${std}/package.json`, JSON.stringify({ name: '@ai-ecoverse/wasm-go-std-wasip1', slicc: { go: { version: 'go1.27.4', std: [{ target: 'wasip1/wasm', dir: 'pkg' }] } } }));
  for (const p of ['fmt', 'os', 'embed', 'errors', 'strings']) fs.put(`${std}/pkg/${p}.a`, `!<arch>\n${p}`);
  fs.mkdirSync(`${HOME}`);
  fs.mkdirSync('/tmp');
  return fs;
}

function optionValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i < 0 ? undefined : argv[i + 1];
}

async function go(fs, argv, { cwd = HOME, env = {}, fetch } = {}) {
  const runs = [];
  let stdout = '';
  let stderr = '';
  const emit = (fd, t) => {
    const s = typeof t === 'string' ? t : TD.decode(t);
    if (fd === 1) stdout += s;
    else stderr += s;
  };
  const fetches = [];
  const ctx = {
    argv: ['go', ...argv],
    env: { HOME, SLICC_GO_PACKAGE: PKG, GOPROXY: 'https://proxy.test', ...env },
    cwd,
    fs,
    write: async (fd, t) => emit(fd, t),
    sync: {
      write: (fd, t) => emit(fd, t),
      run: (opts) => {
        runs.push(opts.argv);
        const out = optionValue(opts.argv, '-o');
        if (out) fs.writeSync(out, `built by ${opts.argv[0].split('/').pop()}`);
        return { status: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      },
    },
    fetch: fetch
      ? async (url) => {
          fetches.push(url);
          return fetch(url);
        }
      : undefined,
  };
  const status = await goMain(ctx);
  const tools = (name) => runs.filter((a) => a[0].endsWith(`/${name}`));
  return { status, stdout, stderr, runs, fetches, tools };
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function zipOf(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const comp = deflateRawSync(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    local.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += lh.length + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function h1Of(entries) {
  const lines = [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, text]) => `${createHash('sha256').update(text).digest('hex')}  ${name}\n`)
    .join('');
  return `h1:${createHash('sha256').update(lines).digest('base64')}`;
}

function moduleOf(path, version, files) {
  const entries = Object.entries(files).map(([name, text]) => [`${path}@${version}/${name}`, text]);
  return { path, version, entries, zip: zipOf(entries), sum: h1Of(entries) };
}

const escape = (p) => p.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

function proxyFor(...mods) {
  return async (url) => {
    for (const m of mods) {
      if (url === `https://proxy.test/${escape(m.path)}/@v/${escape(m.version)}.zip`) {
        return { status: 200, headers: new Headers(), arrayBuffer: async () => m.zip.buffer.slice(m.zip.byteOffset, m.zip.byteOffset + m.zip.length) };
      }
    }
    return { status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

const GREET = moduleOf('example.test/Greet', 'v1.0.0', {
  'go.mod': 'module example.test/Greet\n\ngo 1.21\n',
  'greet.go': 'package greet\n\nfunc Hello() string { return "hi" }\n',
});

function useApp(fs, { sum = `${GREET.path} ${GREET.version} ${GREET.sum}\n`, extraRequire = '', dir = `${HOME}/use` } = {}) {
  fs.put(`${dir}/go.mod`, `module example.com/use\n\ngo 1.27\n\nrequire ${GREET.path} ${GREET.version}\n${extraRequire}`);
  fs.put(`${dir}/main.go`, `package main\n\nimport greet "${GREET.path}"\n\nfunc main() { println(greet.Hello()) }\n`);
  fs.put(`${dir}/go.sum`, sum);
  return dir;
}

const cacheDir = (m) => `${HOME}/go/pkg/mod/${escape(m.path)}@${m.version}`;

test('wasm-go driver: the h1 of a real module zip is the real go.sum line (rsc.io/quote v1.5.2)', async () => {
  const fs = world();
  fs.put(`${HOME}/q/go.mod`, 'module example.com/q\n\ngo 1.27\n\nrequire rsc.io/quote v1.5.2\n');
  fs.put(`${HOME}/q/go.sum`, `rsc.io/quote v1.5.2 ${QUOTE_SUM}\nrsc.io/quote v1.5.2/go.mod h1:LzX7hefJvL54yjefDEDHNONDjII0t9xZLPXsUe+TKr0=\n`);
  const zip = { path: 'rsc.io/quote', version: 'v1.5.2', zip: QUOTE_ZIP };
  const r = await go(fs, ['mod', 'download'], { cwd: `${HOME}/q`, fetch: proxyFor(zip) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.text(`${HOME}/go/pkg/mod/rsc.io/quote@v1.5.2/.slicc-ok`), `${QUOTE_SUM}\n`);
  assert.match(fs.text(`${HOME}/go/pkg/mod/rsc.io/quote@v1.5.2/quote.go`), /^\/\/ Package quote collects pithy sayings\.$/m);
});

test('wasm-go driver: a download that does not match go.sum is refused and nothing is extracted', async () => {
  const fs = world();
  const dir = useApp(fs, { sum: `${GREET.path} ${GREET.version} h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n` });
  const r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /checksum mismatch[\s\S]*SECURITY ERROR/);
  assert.deepEqual(fs.under(`${HOME}/go/pkg/mod`), []);
});

test('wasm-go driver: a module without a go.sum line is refused, never fetched', async () => {
  const fs = world();
  const dir = useApp(fs, { sum: '' });
  const r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing go\.sum entry for module providing example\.test\/Greet@v1\.0\.0/);
  assert.deepEqual(r.fetches, []);
});

test('wasm-go driver: a module cache entry is checked against go.sum on every build', async () => {
  const fs = world();
  const dir = useApp(fs);
  let r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 0, r.stderr);
  r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.fetches, [], 'a verified cache entry is reused');

  const poisoned = world();
  const pdir = useApp(poisoned);
  poisoned.put(`${cacheDir(GREET)}/go.mod`, 'module example.test/Greet\n\ngo 1.21\n');
  poisoned.put(`${cacheDir(GREET)}/greet.go`, 'package greet\n\nfunc Hello() string { return "evil" }\n');
  poisoned.put(`${cacheDir(GREET)}/.slicc-ok`, 'h1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=\n');
  r = await go(poisoned, ['build'], { cwd: pdir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 1, 'a cache entry another go.sum let in does not match this go.sum');
  assert.match(r.stderr, /checksum mismatch[\s\S]*SECURITY ERROR/);
  assert.deepEqual(r.tools('compile'), []);

  poisoned.put(`${cacheDir(GREET)}/.slicc-ok`, `${GREET.sum}\n`);
  poisoned.put(`${pdir}/go.sum`, '');
  r = await go(poisoned, ['build'], { cwd: pdir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 1, 'a cached module still needs its go.sum line');
  assert.match(r.stderr, /missing go\.sum entry/);

  const foreign = world();
  const fdir = useApp(foreign);
  foreign.put(`${cacheDir(GREET)}/go.mod`, 'module example.test/Greet\n\ngo 1.21\n');
  foreign.put(`${cacheDir(GREET)}/greet.go`, 'package greet\n\nfunc Hello() string { return "unverified" }\n');
  r = await go(foreign, ['build'], { cwd: fdir, fetch: proxyFor(GREET) });
  assert.equal(r.status, 1, 'a module directory this go never verified is not trusted');
  assert.match(r.stderr, /did not extract it/);
  assert.deepEqual(r.tools('compile'), []);
});

test('wasm-go driver: a cached module is hashed again on use, so a planted .slicc-ok cannot vouch for other files', async () => {
  const cases = [
    ['a modified file', (fs) => fs.put(`${cacheDir(GREET)}/greet.go`, 'package greet\n\nfunc Hello() string { return "evil" }\n')],
    ['an extra file', (fs) => fs.put(`${cacheDir(GREET)}/evil.go`, 'package greet\n\nfunc init() { panic("evil") }\n')],
    ['a file in a new directory', (fs) => fs.put(`${cacheDir(GREET)}/sub/x.go`, 'package sub\n')],
    ['a removed file', (fs) => fs.rm(`${cacheDir(GREET)}/go.mod`)],
  ];
  for (const [what, tamper] of cases) {
    const fs = world();
    const dir = useApp(fs);
    let r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(GREET) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.text(`${cacheDir(GREET)}/.slicc-ok`), `${GREET.sum}\n`);
    await tamper(fs);
    r = await go(fs, ['build', '-a'], { cwd: dir, env: { GOPROXY: 'off' } });
    assert.equal(r.status, 1, what);
    assert.match(r.stderr, /checksum mismatch\n\tcached: h1:[\s\S]*go\.sum: {5}h1:[\s\S]*SECURITY ERROR[\s\S]*Remove \/home\/u\/go\/pkg\/mod\/example\.test\/!greet@v1\.0\.0 to download it again/, what);
    assert.deepEqual(r.tools('compile'), [], `${what}: nothing compiled`);
  }
  const fs = world();
  const dir = useApp(fs);
  fs.put(`${cacheDir(GREET)}/go.mod`, 'module example.test/Greet\n\ngo 1.21\n');
  fs.put(`${cacheDir(GREET)}/greet.go`, 'package greet\n\nfunc Hello() string { return "evil" }\n');
  fs.put(`${cacheDir(GREET)}/.slicc-ok`, `${GREET.sum}\n`);
  const r = await go(fs, ['build'], { cwd: dir, env: { GOPROXY: 'off' } });
  assert.equal(r.status, 1, 'a planted .slicc-ok with the right h1 over other sources');
  assert.match(r.stderr, /SECURITY ERROR/);
  assert.deepEqual(r.tools('compile'), []);
});

test('wasm-go driver: module paths and versions that leave the module cache are refused', async () => {
  const fs = world();
  const evil = moduleOf('example.test/../../../../../evil', 'v1.0.0', { 'go.mod': 'module x\n', 'x.go': 'package x\n' });
  fs.put(`${HOME}/m/go.mod`, `module example.com/m\n\ngo 1.27\n\nrequire ${evil.path} v1.0.0\n`);
  fs.put(`${HOME}/m/go.sum`, `${evil.path} v1.0.0 ${evil.sum}\n`);
  const before = [...fs.files.keys()].sort();
  let r = await go(fs, ['mod', 'download'], { cwd: `${HOME}/m`, fetch: proxyFor(evil) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /malformed module path/);
  assert.deepEqual([...fs.files.keys()].sort(), before, 'nothing written (the old driver wrote /home/evil@v1.0.0)');
  assert.deepEqual(r.fetches, []);

  const ver = moduleOf('example.test/v', 'v1.0.0/../../../../../../../evil', { 'go.mod': 'module example.test/v\n' });
  fs.put(`${HOME}/m/go.sum`, `${ver.path} ${ver.version} ${ver.sum}\n`);
  r = await go(fs, ['mod', 'download', `${ver.path}@${ver.version}`], { cwd: `${HOME}/m`, fetch: proxyFor(ver) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /malformed version/);
  assert.deepEqual(fs.under('/evil'), []);
  assert.deepEqual([...fs.files.keys()].filter((k) => !k.startsWith(`${HOME}/m/`)).sort(), before.filter((k) => !k.startsWith(`${HOME}/m/`)));
  assert.deepEqual(r.fetches, []);
});

test('wasm-go driver: an import path with .. cannot reach files outside its module', async () => {
  const fs = world();
  fs.put(`${HOME}/app/go.mod`, 'module example.com/app\n\ngo 1.27\n');
  fs.put(`${HOME}/app/main.go`, 'package main\n\nimport _ "example.com/app/../../secret"\n\nfunc main() {}\n');
  fs.put('/home/secret/s.go', 'package secret\n');
  const r = await go(fs, ['build'], { cwd: `${HOME}/app` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /invalid import path "example\.com\/app\/\.\.\/\.\.\/secret"/);
  assert.ok(!r.runs.flat().some((a) => a.includes('/home/secret')), 'nothing outside the module was compiled');
});

test('wasm-go driver: zip entries with .., duplicates or a bad size are refused before anything is written', async () => {
  for (const [what, entries, want] of [
    ['a ../ entry', [['example.test/Greet@v1.0.0/go.mod', 'module example.test/Greet\n'], ['example.test/Greet@v1.0.0/../../../escape.go', 'package x\n']], /bad zip entry/],
    ['an entry outside the module prefix', [['example.test/Greet@v1.0.0/go.mod', 'module example.test/Greet\n'], ['other@v1.0.0/x.go', 'package x\n']], /outside example\.test\/Greet@v1\.0\.0\//],
    ['a .slicc-ok entry', [['example.test/Greet@v1.0.0/go.mod', 'module example.test/Greet\n'], ['example.test/Greet@v1.0.0/.slicc-ok', 'h1:x\n']], /reserved for the module cache/],
    ['a duplicate entry', [['example.test/Greet@v1.0.0/go.mod', 'module example.test/Greet\n'], ['example.test/Greet@v1.0.0/go.mod', 'module evil\n']], /more than one entry/],
  ]) {
    const fs = world();
    const mod = { path: GREET.path, version: GREET.version, zip: zipOf(entries), sum: h1Of(entries) };
    const dir = useApp(fs, { sum: `${mod.path} ${mod.version} ${mod.sum}\n` });
    const r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor(mod) });
    assert.equal(r.status, 1, what);
    assert.match(r.stderr, want, what);
    assert.deepEqual(fs.under(`${HOME}/go`), [], `${what}: nothing in the module cache`);
    assert.deepEqual(fs.under('/home/escape.go'), [], what);
  }

  const fs = world();
  const big = Buffer.alloc(1 << 20, 0x61);
  const entries = [['example.test/Greet@v1.0.0/go.mod', 'module example.test/Greet\n'], ['example.test/Greet@v1.0.0/big.txt', big]];
  const zip = zipOf(entries);
  const at = zip.indexOf(Buffer.from('example.test/Greet@v1.0.0/big.txt'), zip.readUInt32LE(zip.length - 6));
  zip.writeUInt32LE(16, at - 46 + 24);
  const dir = useApp(fs, { sum: `${GREET.path} ${GREET.version} ${h1Of(entries)}\n` });
  const r = await go(fs, ['build'], { cwd: dir, fetch: proxyFor({ path: GREET.path, version: GREET.version, zip }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /inflates to more than its declared 16 bytes/);
  assert.deepEqual(fs.under(`${HOME}/go`), []);
});

test('wasm-go driver: a dependency that needs a newer version than go.mod lists stops the build', async () => {
  const fs = world();
  const lib = moduleOf('example.test/lib', 'v1.0.0', {
    'go.mod': `module example.test/lib\n\ngo 1.21\n\nrequire ${GREET.path} v1.2.0\n`,
    'lib.go': `package lib\n\nimport greet "${GREET.path}"\n\nfunc Hi() string { return greet.Hello() }\n`,
  });
  fs.put(`${HOME}/w/go.mod`, `module example.com/w\n\ngo 1.27\n\nrequire (\n\t${GREET.path} ${GREET.version}\n\t${lib.path} ${lib.version}\n)\n`);
  fs.put(`${HOME}/w/go.sum`, `${GREET.path} ${GREET.version} ${GREET.sum}\n${lib.path} ${lib.version} ${lib.sum}\n`);
  fs.put(`${HOME}/w/main.go`, `package main\n\nimport "${lib.path}"\n\nfunc main() { println(lib.Hi()) }\n`);
  const r = await go(fs, ['build'], { cwd: `${HOME}/w`, fetch: proxyFor(GREET, lib) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /updates to go\.mod needed: example\.test\/lib@v1\.0\.0 requires example\.test\/Greet@v1\.2\.0, but go\.mod has example\.test\/Greet v1\.0\.0/);
  assert.deepEqual(r.tools('link'), []);
});

test('wasm-go driver: GOPRIVATE and GONOPROXY modules are never asked of GOPROXY', async () => {
  for (const env of [{ GOPRIVATE: 'example.test' }, { GONOPROXY: 'example.test/*' }, { GOPRIVATE: '*.test' }]) {
    const fs = world();
    const dir = useApp(fs);
    const r = await go(fs, ['build'], { cwd: dir, env, fetch: proxyFor(GREET) });
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, /matches GONOPROXY\/GOPRIVATE/);
    assert.deepEqual(r.fetches, [], JSON.stringify(env));
  }
});

test('wasm-go driver: GOPROXY lists fall through as go does (| on any error, , on 404 and 410, off and direct stop)', async () => {
  const flaky = async (url) => (url.startsWith('https://down.test/') ? { status: 500, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } : proxyFor(GREET)(url));
  let fs = world();
  let r = await go(fs, ['build'], { cwd: useApp(fs), env: { GOPROXY: 'https://down.test|https://proxy.test' }, fetch: flaky });
  assert.equal(r.status, 0, r.stderr);
  fs = world();
  r = await go(fs, ['build'], { cwd: useApp(fs), env: { GOPROXY: 'https://down.test,https://proxy.test' }, fetch: flaky });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /down\.test.*: 500/);
  fs = world();
  r = await go(fs, ['build'], { cwd: useApp(fs), env: { GOPROXY: 'off,https://proxy.test' }, fetch: flaky });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /module lookup disabled by GOPROXY=off/);
  assert.deepEqual(r.fetches, []);
  fs = world();
  r = await go(fs, ['build'], { cwd: useApp(fs), env: { GOPROXY: 'direct,https://proxy.test' }, fetch: flaky });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /direct \(VCS\) fetches are not supported/);
  assert.deepEqual(r.fetches, []);
});

test('wasm-go driver: editing an embedded file rebuilds the package (archive cache)', async () => {
  const fs = world();
  const app = `${HOME}/emb`;
  fs.put(`${app}/go.mod`, 'module example.com/emb\n\ngo 1.27\n');
  fs.put(`${app}/main.go`, 'package main\n\nimport _ "embed"\n\n//go:embed asset.txt\nvar s string\n\nfunc main() { println(s) }\n');
  fs.put(`${app}/asset.txt`, 'before\n');
  let r = await go(fs, ['build'], { cwd: app });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.tools('compile').length, 1);
  r = await go(fs, ['build'], { cwd: app });
  assert.equal(r.tools('compile').length, 0, 'unchanged: cached');
  fs.put(`${app}/asset.txt`, 'after\n');
  r = await go(fs, ['build'], { cwd: app });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.tools('compile').length, 1, 'an edited embedded file is a new archive');
});

test('wasm-go driver: -gcflags and -asmflags reach the packages go gives them to', async () => {
  const fs = world();
  const app = `${HOME}/fl`;
  fs.put(`${app}/go.mod`, 'module example.com/fl\n\ngo 1.27\n');
  fs.put(`${app}/main.go`, 'package main\n\nimport "example.com/fl/lib"\n\nfunc main() { println(lib.Answer()) }\n');
  fs.put(`${app}/lib/lib.go`, 'package lib\n\nfunc Answer() int64\n');
  fs.put(`${app}/lib/answer_wasm.s`, '#include "textflag.h"\n\nTEXT ·Answer(SB), NOSPLIT, $0-8\n\tRET\n');
  let r = await go(fs, ['build', '-gcflags=-N -l', '.'], { cwd: app });
  assert.equal(r.status, 0, r.stderr);
  const compiles = (res) => Object.fromEntries(res.tools('compile').map((a) => [optionValue(a, '-p'), a]));
  let c = compiles(r);
  assert.ok(c.main.includes('-N') && c.main.includes('-l'), 'a pattern-less -gcflags applies to the named package');
  assert.ok(!c['example.com/fl/lib'].includes('-N'), 'and not to its dependencies');
  r = await go(fs, ['build', '-a', '-gcflags=all=-N', '-asmflags=all=-D=SLICC', '.'], { cwd: app });
  assert.equal(r.status, 0, r.stderr);
  c = compiles(r);
  assert.ok(c.main.includes('-N') && c['example.com/fl/lib'].includes('-N'), 'all= reaches every package built');
  assert.match(r.stderr, /does not reach the standard library/);
  assert.ok(r.tools('asm').length >= 2 && r.tools('asm').every((a) => a.includes('-D=SLICC')), '-asmflags reaches asm');
  r = await go(fs, ['build', '-gcflags=example.com/fl/lib=-N', '.'], { cwd: app });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /package patterns other than all are not supported/);
});

test('wasm-go driver: a go.work is refused unless GOWORK=off', async () => {
  const fs = world();
  fs.put(`${HOME}/ws/go.work`, 'go 1.27\n\nuse ./a\n');
  fs.put(`${HOME}/ws/a/go.mod`, 'module example.com/a\n\ngo 1.27\n');
  fs.put(`${HOME}/ws/a/main.go`, 'package main\n\nfunc main() {}\n');
  let r = await go(fs, ['build'], { cwd: `${HOME}/ws/a` });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\/home\/u\/ws\/go\.work: go\.work files are not supported by this go driver yet; set GOWORK=off/);
  assert.deepEqual(r.runs, []);
  r = await go(fs, ['build'], { cwd: `${HOME}/ws/a`, env: { GOWORK: 'off' } });
  assert.equal(r.status, 0, r.stderr);
});

test('wasm-go driver: unsupported commands and flags exit 2 and say so', async () => {
  const fs = world();
  fs.put(`${HOME}/u/go.mod`, 'module example.com/u\n\ngo 1.27\n');
  fs.put(`${HOME}/u/main.go`, 'package main\n\nfunc main() {}\n');
  for (const cmd of ['test', 'get', 'install', 'list', 'vet', 'work', 'generate', 'tool', 'fmt', 'clean', 'doc', 'fix', 'bug', 'telemetry']) {
    const r = await go(fs, [cmd], { cwd: `${HOME}/u` });
    assert.equal(r.status, 2, cmd);
    assert.equal(r.stderr, `go ${cmd}: not supported by this go driver yet\n`, cmd);
    assert.deepEqual(r.runs, [], cmd);
  }
  for (const [argv, want] of [
    [['mod', 'tidy'], /go mod tidy: not supported by this go driver \(only go mod download\)/],
    [['mod', 'download', '-json'], /go mod download: -json is not supported by this go driver/],
    [['build', '-race'], /-race is not supported/],
    [['build', '-cover'], /-cover is not supported/],
    [['build', '-buildmode=c-shared'], /-buildmode is not supported/],
    [['build', '-n'], /-n is not supported/],
    [['build', '-modfile=x.mod'], /-modfile is not supported/],
    [['build', '-overlay=o.json'], /-overlay is not supported/],
    [['build', '-pgo=default.pgo'], /-pgo is not supported/],
    [['build', '-mod=frob'], /-mod=frob: want readonly, vendor or mod/],
    [['build', '-o', 'x', '-C', '.'], /-C flag must be first flag/],
    [['env', '-w', 'GOFLAGS=-x'], /go env: -w is not supported/],
    [['version', '-m', 'x'], /reading the version of a binary is not supported/],
    [['frob'], /go frob: unknown command/],
  ]) {
    const r = await go(fs, argv, { cwd: `${HOME}/u` });
    assert.equal(r.status, 2, argv.join(' '));
    assert.match(r.stderr, want, argv.join(' '));
    assert.deepEqual(r.runs, [], argv.join(' '));
  }
  const help = await go(fs, ['help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Go is a tool/);
});
