import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const MOD = 'example.test/Greet';
const VER = 'v1.0.0';
const GREET = 'package greet\n\nfunc Hello(name string) string { return "hello, " + name }\n';

function zipOf(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    local.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
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

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function h1(entries) {
  const lines = [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, text]) => `${createHash('sha256').update(text).digest('hex')}  ${name}\n`)
    .join('');
  return `h1:${createHash('sha256').update(lines).digest('base64')}`;
}

const escape = (p) => p.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

function moduleOf(path, version, files, raw = []) {
  const entries = [...Object.entries(files).map(([name, text]) => [`${path}@${version}/${name}`, text]), ...raw];
  return { path, version, url: `/${escape(path)}/@v/${version}.zip`, zip: zipOf(entries), sum: h1(entries) };
}

export default async function go(ctx) {
  const { assert, write } = ctx;
  await ctx.addUser({ name: 'gopher' });
  const home = '/home/gopher';
  const env = { HOME: home, GOPROXY: 'http://proxy.test', GOFLAGS: '' };
  const run = (argv, cwd = home, extra = {}) => ctx.run(argv, { cwd, user: 'gopher', env: { ...env, ...extra } });
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 3000)}\n${r.stderr.slice(0, 3000)}`;
  const ls = async (dir) => (await run(['bash', '-c', `ls -a ${dir} 2>&1 || true`])).stdout;

  const greet = moduleOf(MOD, VER, { 'go.mod': `module ${MOD}\n\ngo 1.21\n`, 'greet.go': GREET });
  const escaping = moduleOf(MOD, 'v1.0.1', { 'go.mod': `module ${MOD}\n\ngo 1.21\n`, 'greet.go': GREET }, [[`${MOD}@v1.0.1/../../../../escape.go`, 'package escape\n']]);
  const wrap = moduleOf('example.test/wrap', VER, {
    'go.mod': `module example.test/wrap\n\ngo 1.21\n\nrequire ${MOD} ${VER}\n\nreplace ${MOD} => ${home}/evil\n`,
    'wrap.go': `package wrap\n\nimport greet "${MOD}"\n\nfunc Hi() string { return greet.Hello("wrapped") }\n`,
  });
  const served = Object.fromEntries([greet, escaping, wrap].map((m) => [m.url, m.zip.toString('base64')]));
  const responder = new Function(
    'req',
    `const served = ${JSON.stringify(served)};
     const u = new URL(req.url);
     const b64 = served[u.pathname];
     if (b64) {
       const b = atob(b64);
       const body = new Uint8Array(b.length);
       for (let i = 0; i < b.length; i++) body[i] = b.charCodeAt(i);
       return { status: 200, headers: [['content-type', 'application/zip']], body };
     }
     return { status: 404, statusText: 'Not Found', headers: [], body: 'not found' };`,
  );
  await ctx.serve(responder);

  let r = await run(['go', 'version']);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /^go version go1\.27\.\d+ wasip1\/wasm\n$/, out(r));
  r = await run(['go', 'env', 'GOOS', 'GOARCH', 'GOMODCACHE']);
  assert.equal(r.stdout, `wasip1\nwasm\n${home}/go/pkg/mod\n`, out(r));

  const app = `${home}/app`;
  await write(`${app}/go.mod`, 'module example.com/app\n\ngo 1.27\n');
  await write(`${app}/static/a.txt`, 'hi\n');
  await write(`${app}/static/sub/b.txt`, 'deep\n');
  await write(`${app}/static/.hidden`, 'x\n');
  await write(`${app}/main.go`, [
    'package main',
    '',
    'import (',
    '\t"embed"',
    '\t"fmt"',
    '\t"io/fs"',
    '\t"os"',
    '',
    '\t"example.com/app/lib"',
    ')',
    '',
    '//go:embed static',
    'var files embed.FS',
    '',
    'func main() {',
    '\tfs.WalkDir(files, ".", func(p string, d fs.DirEntry, err error) error {',
    '\t\tif !d.IsDir() {',
    '\t\t\tb, _ := files.ReadFile(p)',
    '\t\t\tfmt.Printf("embed %s %q\\n", p, b)',
    '\t\t}',
    '\t\treturn nil',
    '\t})',
    '\tfmt.Println("tag", lib.Which(), "asm", lib.Answer(), "args", os.Args[1:])',
    '}',
    '',
  ].join('\n'));
  await write(`${app}/lib/lib.go`, 'package lib\n\nfunc Answer() int64\n');
  await write(`${app}/lib/plain.go`, '//go:build !special\n\npackage lib\n\nfunc Which() string { return "default" }\n');
  await write(`${app}/lib/special.go`, '//go:build special\n\npackage lib\n\nfunc Which() string { return "special" }\n');
  await write(`${app}/lib/x_linux.go`, 'package lib\n\nfunc Which() string { return "linux" }\n');
  await write(`${app}/lib/answer_wasm.s`, '#include "textflag.h"\n\nTEXT ·Answer(SB), NOSPLIT, $0-8\n\tMOVD $42, ret+0(FP)\n\tRET\n');

  r = await run(['go', 'build'], app);
  assert.equal(r.status, 0, out(r));
  r = await run(['./app', 'x'], app);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'embed static/a.txt "hi\\n"\nembed static/sub/b.txt "deep\\n"\ntag default asm 42 args [x]\n', out(r));
  r = await run(['go', 'run', '-tags', 'special', '.', 'y', 'z'], app);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /^tag special asm 42 args \[y z\]$/m, out(r));
  r = await run(['go', 'build', '-x', '-o', 'again'], app);
  assert.equal(r.status, 0, out(r));
  assert.doesNotMatch(r.stderr, /\/compile /, `an unchanged rebuild compiles nothing (archive cache): ${out(r)}`);
  assert.match(r.stderr, /\/link /, out(r));
  await write(`${app}/static/a.txt`, 'edited\n');
  r = await run(['go', 'run', '-x', '.'], app);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stderr, /\/compile /, `an edited embedded file is compiled again: ${out(r)}`);
  assert.match(r.stdout, /^embed static\/a\.txt "edited\\n"$/m, out(r));

  const use = `${home}/use`;
  await write(`${use}/go.mod`, `module example.com/use\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n`);
  await write(`${use}/main.go`, `package main\n\nimport (\n\t"fmt"\n\n\tgreet "${MOD}"\n)\n\nfunc main() { fmt.Println(greet.Hello("slicc")) }\n`);
  await write(`${use}/go.sum`, `${MOD} ${VER} ${greet.sum.replace(/^h1:./, (m) => (m === 'h1:A' ? 'h1:B' : 'h1:A'))}\n`);
  r = await run(['go', 'build'], use);
  assert.equal(r.status, 1, `a go.sum mismatch stops the build: ${out(r)}`);
  assert.match(r.stderr, /checksum mismatch[\s\S]*SECURITY ERROR/, out(r));
  assert.doesNotMatch(await ls(`${home}/go/pkg/mod/example.test`), /!greet@/, 'nothing extracted after a mismatch');
  await write(`${use}/go.sum`, '');
  r = await run(['go', 'build'], use);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /missing go\.sum entry for module providing example\.test\/Greet@v1\.0\.0/, out(r));
  await write(`${use}/go.sum`, `${MOD} ${VER} ${greet.sum}\n`);
  r = await run(['go', 'run', '.'], use);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'hello, slicc\n', out(r));
  assert.match(await ls(`${home}/go/pkg/mod/example.test/`), /^!greet@v1\.0\.0$/m, 'the module cache escapes upper case');

  const other = `${home}/other`;
  await write(`${other}/go.mod`, `module example.com/other\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n`);
  await write(`${other}/main.go`, `package main\n\nimport greet "${MOD}"\n\nfunc main() { println(greet.Hello("other")) }\n`);
  await write(`${other}/go.sum`, `${MOD} ${VER} h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n`);
  r = await run(['go', 'build'], other);
  assert.equal(r.status, 1, `a cached module is checked against each go.sum: ${out(r)}`);
  assert.match(r.stderr, /checksum mismatch\n\tcached: [\s\S]*SECURITY ERROR/, out(r));
  await write(`${other}/go.sum`, '');
  r = await run(['go', 'build'], other);
  assert.equal(r.status, 1, `a cached module still needs a go.sum line: ${out(r)}`);
  assert.match(r.stderr, /missing go\.sum entry/, out(r));

  const esc = `${home}/esc`;
  await write(`${esc}/go.mod`, `module example.com/esc\n\ngo 1.27\n\nrequire ${MOD} v1.0.1\n`);
  await write(`${esc}/main.go`, `package main\n\nimport greet "${MOD}"\n\nfunc main() { println(greet.Hello("esc")) }\n`);
  await write(`${esc}/go.sum`, `${MOD} v1.0.1 ${escaping.sum}\n`);
  r = await run(['go', 'build'], esc);
  assert.equal(r.status, 1, `a zip entry with ../ is refused even when go.sum matches: ${out(r)}`);
  assert.match(r.stderr, /bad zip entry example\.test\/Greet@v1\.0\.1\/\.\.\/\.\.\/\.\.\/\.\.\/escape\.go/, out(r));
  assert.doesNotMatch(await ls(`${home}/go/pkg/mod/example.test`), /!greet@v1\.0\.1/, 'nothing extracted from it');
  for (const dir of [`${home}/go/pkg/mod`, `${home}/go/pkg`, `${home}/go`, home]) {
    assert.doesNotMatch(await ls(dir), /^escape\.go$/m, `nothing written to ${dir}`);
  }

  await write(`${home}/evil/go.mod`, `module ${MOD}\n\ngo 1.21\n`);
  await write(`${home}/evil/greet.go`, 'package greet\n\nfunc Hello(name string) string { return "evil, " + name }\n');
  const dep = `${home}/dep`;
  await write(`${dep}/go.mod`, `module example.com/dep\n\ngo 1.27\n\nrequire (\n\t${MOD} ${VER}\n\texample.test/wrap ${VER}\n)\n`);
  await write(`${dep}/go.sum`, `${MOD} ${VER} ${greet.sum}\nexample.test/wrap ${VER} ${wrap.sum}\n`);
  await write(`${dep}/main.go`, 'package main\n\nimport "example.test/wrap"\n\nfunc main() { println(wrap.Hi()) }\n');
  r = await run(['go', 'run', '.'], dep);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'hello, wrapped\n', `a dependency's replace (to ${home}/evil, outside it) is ignored, as go ignores it: ${out(r)}`);
  const gone = `${home}/gone`;
  await write(`${gone}/go.mod`, `module example.com/gone\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n\nreplace ${MOD} => ../missing\n`);
  await write(`${gone}/main.go`, `package main\n\nimport greet "${MOD}"\n\nfunc main() { println(greet.Hello("gone")) }\n`);
  r = await run(['go', 'build'], gone, { GOPROXY: 'off' });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /replacement directory \.\.\/missing does not exist/, out(r));
  r = await run(['go', 'build'], use, { GOPRIVATE: 'example.test', GOMODCACHE: `${home}/private` });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /matches GONOPROXY\/GOPRIVATE \(example\.test\)/, out(r));
  await write(`${home}/ws/go.work`, 'go 1.27\n\nuse ./m\n');
  await write(`${home}/ws/m/go.mod`, 'module example.com/m\n\ngo 1.27\n');
  await write(`${home}/ws/m/main.go`, 'package main\n\nfunc main() { println("ws") }\n');
  r = await run(['go', 'build'], `${home}/ws/m`);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /go\.work files are not supported by this go driver yet; set GOWORK=off/, out(r));
  r = await run(['go', 'run', '.'], `${home}/ws/m`, { GOWORK: 'off' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'ws\n', out(r));

  const ven = `${home}/ven`;
  await write(`${ven}/go.mod`, `module example.com/ven\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n`);
  await write(`${ven}/main.go`, `package main\n\nimport greet "${MOD}"\n\nfunc main() { println(greet.Hello("vendor")) }\n`);
  await write(`${ven}/vendor/modules.txt`, `# ${MOD} ${VER}\n## explicit\n${MOD}\n`);
  await write(`${ven}/vendor/${MOD}/greet.go`, GREET);
  r = await run(['go', 'run', '.'], ven, { GOPROXY: 'off', GOMODCACHE: `${home}/empty` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'hello, vendor\n', out(r));
  const rep = `${home}/rep`;
  await write(`${rep}/go.mod`, `module example.com/rep\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n\nreplace ${MOD} => ./greet\n`);
  await write(`${rep}/greet/go.mod`, `module ${MOD}\n\ngo 1.21\n`);
  await write(`${rep}/greet/greet.go`, GREET.replace('hello, ', 'local, '));
  await write(`${rep}/main.go`, `package main\n\nimport greet "${MOD}"\n\nfunc main() { println(greet.Hello("replace")) }\n`);
  r = await run(['go', 'run', '.'], rep, { GOPROXY: 'off', GOMODCACHE: `${home}/empty` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'local, replace\n', out(r));

  await write(`${home}/bad/ce.go`, 'package main\n\nfunc main() { x := 1 }\n');
  r = await run(['go', 'run', 'ce.go'], `${home}/bad`);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /^# command-line-arguments\n\.\/ce\.go:3:15: declared and not used: x$/m, out(r));
  await write(`${home}/bad/imp.go`, 'package main\n\nimport _ "example.org/nope"\n\nfunc main() {}\n');
  r = await run(['go', 'build', 'imp.go'], `${home}/bad`);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /no required module provides package example\.org\/nope/, out(r));
  for (const cmd of ['test', 'get', 'install', 'list', 'vet', 'work']) {
    r = await run(['go', cmd], app);
    assert.equal(r.status, 2, out(r));
    assert.equal(r.stderr, `go ${cmd}: not supported by this go driver yet\n`, out(r));
  }
  r = await run(['go', 'build', '-race'], app);
  assert.equal(r.status, 2, out(r));
  r = await run(['go', 'frob']);
  assert.equal(r.status, 2, out(r));
  console.log('go: version, env, build/run with embed (an edited asset recompiles), tags, file-name constraints and asm; archive cache; proxy download checked against go.sum (mismatch, missing entry, a cached module against another go.sum, a ../ zip entry: all refused; !-escaped cache path); a dependency\'s replace outside it ignored, a missing replace directory refused; GOPRIVATE not fetched; go.work refused; vendor; local replace; compile/import errors rc 1; test/get/install/list/vet/work, -race and an unknown command rc 2');
}
