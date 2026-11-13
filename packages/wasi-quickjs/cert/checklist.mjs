import { readFileSync } from 'node:fs';

const upstream = JSON.parse(readFileSync(new URL('../package/package.json', import.meta.url), 'utf8')).homescoop.upstream;

export default async function (ctx) {
  const { run, assert } = ctx;
  const home = '/home/qjs';
  const out = (label, r) => `${label}: rc=${r.status}\n--- stdout\n${String(r.stdout).slice(0, 600)}\n--- stderr\n${String(r.stderr).slice(0, 600)}`;
  const sh = (script, opts = {}) => run(['bash', '-c', script], { cwd: home, ...opts });
  const put = async (path, text) => {
    const r = await run(['bash', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'put', path], { cwd: '/', stdin: text });
    assert.equal(r.status, 0, out(`write ${path}`, r));
  };
  const ok = (label, r, stdout) => {
    assert.equal(r.status, 0, out(label, r));
    assert.equal(r.stdout, stdout, out(label, r));
  };

  await put(`${home}/hello.js`, 'console.log("hello", 6 * 7, typeof scriptArgs, JSON.stringify(scriptArgs.slice(1)));\n');
  await put(`${home}/line.js`, 'import * as std from "qjs:std";\nconst l = std.in.getline();\nconsole.log("got:" + l);\n');
  await put(`${home}/count.js`, 'let n = 0, sum = 0, l;\nwhile ((l = std.in.getline()) !== null) { n++; sum += Number(l); }\nconsole.log(n, sum);\n');
  await put(`${home}/stdin-module.js`, 'import * as os from "qjs:os";\nconsole.log("module", os.platform);\n');
  await put(`${home}/mod/main.mjs`, 'import { greet } from "./lib/greet.mjs";\nimport data from "./data.json" with { type: "json" };\nimport * as all from "../mod/lib/greet.mjs";\nconsole.log(greet(data.name), all.version);\n');
  await put(`${home}/mod/lib/greet.mjs`, 'import { suffix } from "../util/suffix.mjs";\nexport const version = 3;\nexport function greet(n) { return "hi " + n + suffix; }\n');
  await put(`${home}/mod/util/suffix.mjs`, 'export const suffix = "!";\n');
  await put(`${home}/mod/data.json`, '{ "name": "qjs" }\n');
  await put(`${home}/mod/dyn.js`, 'import("./lib/greet.mjs").then((m) => console.log("dynamic", m.greet("x")));\n');

  let r = await run(['qjs', '-v'], { cwd: home });
  ok('qjs -v', r, `${upstream}\n`);
  r = await run(['qjs', '--help'], { cwd: home });
  assert.equal(r.status, 0, out('qjs --help', r));
  assert.match(r.stdout, new RegExp(`^QuickJS-ng version ${upstream.replaceAll('.', '\\.')}\nusage: qjs \\[options\\] \\[file \\[args\\]\\]\n`), out('qjs --help', r));

  r = await sh(`qjs -e 'console.log(1+1, JSON.stringify({a:[1,2,3].map(x=>x*2)}))'`);
  ok('qjs -e', r, '2 {"a":[2,4,6]}\n');
  r = await sh(`QJS_T=yes qjs --std -e 'std.puts(std.getenv("QJS_T") + " " + typeof os.readdir + "\\n")'`);
  ok('qjs --std -e', r, 'yes function\n');

  r = await sh('qjs hello.js a "b c"');
  ok('qjs file.js args', r, 'hello 42 object ["a","b c"]\n');
  r = await sh('timeout 20 qjs < hello.js');
  ok('qjs < file.js (0002: a script, not the REPL)', r, 'hello 42 object []\n');
  r = await sh('cat hello.js | timeout 20 qjs');
  ok('cat file.js | qjs', r, 'hello 42 object []\n');
  r = await sh('timeout 20 qjs - x < hello.js');
  ok('qjs - x < file.js', r, 'hello 42 object ["x"]\n');
  r = await run(['qjs'], { cwd: home, stdin: 'console.log("from ctx stdin", [..."abc"].reverse().join(""))\n' });
  ok('qjs with stdin from the caller', r, 'from ctx stdin cba\n');
  r = await sh('timeout 20 qjs < stdin-module.js');
  ok('qjs < module (import detected)', r, 'module wasi\n');
  r = await sh('timeout 20 qjs < /dev/null');
  ok('qjs < /dev/null', r, '');

  r = await sh('echo piped | qjs line.js');
  ok('echo piped | qjs line.js', r, 'got:piped\n');
  r = await sh('seq 1 20000 | qjs --std count.js');
  ok('seq 1 20000 | qjs --std count.js', r, '20000 200010000\n');
  r = await sh(`printf 'a\\nb\\n' | qjs -e 'import * as std from "qjs:std"; console.log(JSON.stringify(std.in.readAsString()))' | tr a-z A-Z`);
  ok('a pipe in and out', r, '"A\\NB\\N"\n');

  await put(`${home}/files.js`, [
    'import * as std from "qjs:std";',
    'import * as os from "qjs:os";',
    'const write = (p, s) => { const f = std.open(p, "w"); if (!f) throw new Error("open " + p); f.puts(s); f.close(); };',
    'os.mkdir("out");',
    'write("out/rel.txt", "relative\\n");',
    'write("/tmp/qjs-abs.txt", "absolute\\n");',
    'write("./out/dot.txt", "dot\\n");',
    'write("../qjs/out/up.txt", "up\\n");',
    'const a = std.open("out/rel.txt", "a"); a.puts("appended\\n"); a.close();',
    'console.log(JSON.stringify([std.loadFile("out/rel.txt"), std.loadFile("/tmp/qjs-abs.txt"), std.loadFile("/home/qjs/out/dot.txt"), std.loadFile("out/up.txt")]));',
    'const e = {};',
    'console.log(std.open("missing.txt", "r", e), e.errno === std.Error.ENOENT, std.strerror(e.errno), std.loadFile("missing.txt"));',
    'std.writeFile("out/w.bin", new Uint8Array([104, 105, 10]));',
    'const bytes = std.loadFile("out/w.bin", { binary: true });',
    'console.log(bytes.length, os.readdir("out")[0].filter((n) => n[0] !== ".").sort().join(","));',
    'console.log(os.rename("out/w.bin", "out/v.bin"), os.remove("out/dot.txt"), os.stat("out/v.bin")[0].size);',
  ].join('\n') + '\n');
  r = await sh('qjs files.js && cat out/rel.txt /tmp/qjs-abs.txt out/up.txt out/v.bin && ls out');
  ok('qjs:std reads and writes by relative and absolute paths', r, [
    '["relative\\nappended\\n","absolute\\n","dot\\n","up\\n"]',
    'null true No such file or directory null',
    '3 dot.txt,rel.txt,up.txt,w.bin',
    '0 0 3',
    'relative', 'appended', 'absolute', 'up', 'hi',
    'rel.txt', 'up.txt', 'v.bin',
    '',
  ].join('\n'));

  r = await sh(`qjs -e 'import * as std from "qjs:std"; std.exit(7)'`);
  assert.equal(r.status, 7, out('std.exit(7)', r));
  r = await sh(`qjs -e 'import * as std from "qjs:std"; std.exit(300)'`);
  assert.equal(r.status, 44, out('std.exit(300) is 300 & 255', r));
  r = await sh(`qjs -e 'import * as std from "qjs:std"; std.exit(0)'; echo "rc=$?"`);
  ok('std.exit(0)', r, 'rc=0\n');
  r = await sh(`qjs -e 'console.log("before"); throw new Error("boom")'`);
  assert.equal(r.status, 1, out('uncaught exception', r));
  assert.equal(r.stdout, 'before\n', out('uncaught exception', r));
  assert.match(r.stderr, /^Error: boom\n    at <anonymous> \(<cmdline>:1:/, out('uncaught exception', r));
  r = await sh(`qjs -e 'Promise.reject(new Error("rej"))'`);
  assert.equal(r.status, 1, out('unhandled rejection', r));
  assert.match(r.stderr, /^Possibly unhandled promise rejection: Error: rej\n/, out('unhandled rejection', r));
  r = await sh(`qjs -e 'syntax error'`);
  assert.equal(r.status, 1, out('syntax error', r));
  assert.match(r.stderr, /^SyntaxError: /, out('syntax error', r));
  r = await sh('qjs missing.js');
  assert.equal(r.status, 1, out('missing file', r));
  assert.equal(r.stderr, 'missing.js: No such file or directory\n', out('missing file', r));
  r = await sh(`echo 'throw new TypeError("piped")' | qjs`);
  assert.equal(r.status, 1, out('uncaught exception from stdin', r));
  assert.match(r.stderr, /^TypeError: piped\n    at <anonymous> \(<stdin>:1:/, out('uncaught exception from stdin', r));

  r = await sh('qjs mod/main.mjs');
  ok('ES modules by relative paths', r, 'hi qjs! 3\n');
  r = await run(['qjs', '/home/qjs/mod/main.mjs'], { cwd: '/' });
  ok('ES modules from another cwd', r, 'hi qjs! 3\n');
  r = await run(['qjs', '../main.mjs'], { cwd: '/home/qjs/mod/util' });
  ok('ES modules by a ../ path', r, 'hi qjs! 3\n');
  r = await sh('qjs mod/dyn.js');
  ok('dynamic import()', r, 'dynamic hi x!\n');

  r = await sh(`qjs -e 'import * as os from "qjs:os"; const t0 = os.now(); os.setTimeout(() => console.log("timer", os.now() - t0 >= 40), 50); console.log("first")'`);
  ok('os.setTimeout', r, 'first\ntimer true\n');
  r = await sh(`qjs -e 'import * as os from "qjs:os"; await os.sleepAsync(20); const t0 = Date.now(); os.sleep(30); console.log(Date.now() - t0 >= 25)'`);
  ok('os.sleepAsync, os.sleep', r, 'true\n');
  r = await sh(`qjs -e 'console.log([1n << 64n, "ß".toUpperCase(), /\\p{L}+/u.exec("é1")[0], [3,1,2].toSorted().join()].join(" "))'`);
  ok('language', r, '18446744073709551616 SS é 1,2,3\n');
  console.log('checklist: -e, a file, < file, pipes, - and caller stdin; qjs:std files by relative and absolute paths; exit statuses; ES modules by relative paths; timers');
}
