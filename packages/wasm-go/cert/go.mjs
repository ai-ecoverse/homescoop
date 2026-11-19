/**
 * wasm-go's `go` command (bin/go.mjs, a slicc-kernel JS program), as gopher
 * under users enforce, with wasm-go-std-wasip1 installed beside it:
 * go version / go env; go build and go run of a module (embed, a //go:build
 * tag, a file-name constraint, Go assembly); a required module downloaded
 * from a GOPROXY that ctx.serve() answers, checked against go.sum, cached in
 * GOMODCACHE, with a mixed-case path (escaped as !x); a vendored module; a
 * local replace; the archive cache (an unchanged rebuild compiles nothing);
 * and the failures: a go.sum mismatch (SECURITY ERROR, nothing extracted), a
 * missing go.sum entry, an unknown import, a compile error, unknown commands
 * and refused flags.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const MOD = 'example.test/Greet';
const VER = 'v1.0.0';
const GREET = 'package greet\n\nfunc Hello(name string) string { return "hello, " + name }\n';

/** A module zip as the proxy serves it: entries named <path>@<version>/<file>. */
function moduleZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(`${MOD}@${VER}/${name}`);
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
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
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

/** go.sum's h1: dirhash.Hash1 over the zip's files. */
function h1(files) {
  const lines = Object.entries(files)
    .map(([name, text]) => [`${MOD}@${VER}/${name}`, text])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, text]) => `${createHash('sha256').update(text).digest('hex')}  ${name}\n`)
    .join('');
  return `h1:${createHash('sha256').update(lines).digest('base64')}`;
}

export default async function go(ctx) {
  const { assert, write } = ctx;
  await ctx.addUser({ name: 'gopher' });
  const home = '/home/gopher';
  const env = { HOME: home, GOPROXY: 'http://proxy.test', GOFLAGS: '' };
  const run = (argv, cwd = home, extra = {}) => ctx.run(argv, { cwd, user: 'gopher', env: { ...env, ...extra } });
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 3000)}\n${r.stderr.slice(0, 3000)}`;

  const files = { 'go.mod': `module ${MOD}\n\ngo 1.21\n`, 'greet.go': GREET };
  const zip = moduleZip(files);
  const sum = h1(files);
  const responder = new Function(
    'req',
    `const u = new URL(req.url);
     if (u.pathname === '/example.test/!greet/@v/${VER}.zip') {
       const b = atob(${JSON.stringify(zip.toString('base64'))});
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

  // A module with embed, a build tag, a file-name constraint and assembly.
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
    '\t\t\tfmt.Println("embed", p)',
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
  assert.equal(r.stdout, 'embed static/a.txt\nembed static/sub/b.txt\ntag default asm 42 args [x]\n', out(r));
  r = await run(['go', 'run', '-tags', 'special', '.', 'y', 'z'], app);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /^tag special asm 42 args \[y z\]$/m, out(r));
  r = await run(['go', 'build', '-x', '-o', 'again'], app);
  assert.equal(r.status, 0, out(r));
  assert.doesNotMatch(r.stderr, /\/compile /, `an unchanged rebuild compiles nothing (archive cache): ${out(r)}`);
  assert.match(r.stderr, /\/link /, out(r));

  // A required module from the proxy, checked against go.sum.
  const use = `${home}/use`;
  await write(`${use}/go.mod`, `module example.com/use\n\ngo 1.27\n\nrequire ${MOD} ${VER}\n`);
  await write(`${use}/main.go`, `package main\n\nimport (\n\t"fmt"\n\n\tgreet "${MOD}"\n)\n\nfunc main() { fmt.Println(greet.Hello("slicc")) }\n`);
  await write(`${use}/go.sum`, `${MOD} ${VER} ${sum.replace(/^h1:./, 'h1:A')}\n`);
  r = await run(['go', 'build'], use);
  assert.equal(r.status, 1, `a go.sum mismatch stops the build: ${out(r)}`);
  assert.match(r.stderr, /checksum mismatch[\s\S]*SECURITY ERROR/, out(r));
  r = await run(['bash', '-c', `ls ${home}/go/pkg/mod/example.test 2>&1 || true`]);
  assert.doesNotMatch(r.stdout, /!greet@/, `nothing extracted after a mismatch: ${out(r)}`);
  await write(`${use}/go.sum`, '');
  r = await run(['go', 'build'], use);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /missing go\.sum entry for module providing example\.test\/Greet@v1\.0\.0/, out(r));
  await write(`${use}/go.sum`, `${MOD} ${VER} ${sum}\n`);
  r = await run(['go', 'run', '.'], use);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'hello, slicc\n', out(r));
  r = await run(['bash', '-c', `ls ${home}/go/pkg/mod/example.test/`]);
  assert.match(r.stdout, /^!greet@v1\.0\.0$/m, `the module cache escapes upper case: ${out(r)}`);

  // vendor/ and a local replace, with an empty GOPROXY: nothing is fetched.
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

  // Failures.
  await write(`${home}/bad/ce.go`, 'package main\n\nfunc main() { x := 1 }\n');
  r = await run(['go', 'run', 'ce.go'], `${home}/bad`);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /^# command-line-arguments\n\.\/ce\.go:3:15: declared and not used: x$/m, out(r));
  await write(`${home}/bad/imp.go`, 'package main\n\nimport _ "example.org/nope"\n\nfunc main() {}\n');
  r = await run(['go', 'build', 'imp.go'], `${home}/bad`);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /no required module provides package example\.org\/nope/, out(r));
  r = await run(['go', 'test']);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /go test: not supported by this go driver yet/, out(r));
  r = await run(['go', 'build', '-race'], app);
  assert.equal(r.status, 2, out(r));
  r = await run(['go', 'frob']);
  assert.equal(r.status, 2, out(r));
  console.log('go: version, env, build/run with embed, tags, file-name constraints and asm; archive cache; proxy download checked against go.sum (mismatch refused, missing entry refused, !-escaped cache path); vendor; local replace; compile/import errors rc 1; go test, -race and an unknown command rc 2');
}
