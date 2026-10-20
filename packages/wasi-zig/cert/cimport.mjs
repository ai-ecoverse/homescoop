/**
 * C headers and C++ exceptions (0.16.0-18, patches/0027), as root:
 * - homescoop#1061: `@cImport(@cInclude("stdio.h"))` in a program built with
 *   -lc, and `zig translate-c` of a header. Both run zig's translate-c as a
 *   JIT command, which asked std for its own path (unsupported on WASI) and
 *   failed with "unable to find self exe path"; 0027 takes it from ZIG_EXE
 *   (the package's command env), as zig build and zig run already did.
 * - homescoop#1062: `zig c++` without -fno-exceptions, using std::map::at,
 *   links and prints 1. The wasm32-wasi libc++ has no exception support, so
 *   0027 defaults C++ to -fno-exceptions there, as wasi-sdk's clang does.
 * Each zig runs detached and is polled with short runs: the first
 * translate-c compiles the tool, which can take minutes.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const R = '/home/zi';
  await write('home/zi/c/ci.zig', 'const c = @cImport(@cInclude("stdio.h"));\npub fn main() void {\n    _ = c.printf("hi from cimport %d\\n", @as(c_int, 42));\n}\n');
  await write('home/zi/c/api.h', 'int add_two(int a, int b);\nstruct point { int x; int y; };\n#define LIMIT 10\n');
  await write('home/zi/x/e.cpp', '#include <map>\n#include <string>\n#include <cstdio>\nint main() { std::map<std::string, int> m{{"a", 1}}; std::printf("%d\\n", m.at("a")); return 0; }\n');
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-2500)}`;
  // Runs `cmd` detached in `cwd`; its stdout/stderr land in <tag>.out/.err.
  const detached = async (tag, cmd, cwd, limitS = 1500) => {
    const start = await run(['bash', '-c', `rm -f ${tag}.rc; bash -c '${cmd} >${tag}.out 2>${tag}.err; echo $? > ${tag}.rc' </dev/null >/dev/null 2>&1 &`], { cwd });
    assert.equal(start.status, 0, `${tag}: start: ${out(start)}`);
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const p = await run(['bash', '-c', `[ -s ${tag}.rc ] && { read -r rc < ${tag}.rc; echo "rc=$rc"; echo ---; cat ${tag}.out; echo ---; cat ${tag}.err; }; exit 0`], { cwd });
      const m = /^rc=(\d+)\n---\n([\s\S]*?)---\n([\s\S]*)$/.exec(p.stdout);
      if (m) {
        console.log(`cimport: ${tag} rc ${m[1]} in ${Math.round((Date.now() - t0) / 1000)} s`);
        return { status: Number(m[1]), stdout: m[2], stderr: m[3] };
      }
      assert.ok(Date.now() - t0 < limitS * 1000, `${tag}: no exit within ${limitS} s`);
    }
  };

  let r = await detached('ci', 'zig build-exe ci.zig -lc -target wasm32-wasi', `${R}/c`);
  assert.equal(r.status, 0, `#1061 zig build-exe of an @cImport program: ${out(r)}`);
  assert.doesNotMatch(r.stderr, /self exe path/, `#1061 ${out(r)}`);
  r = await run([`${R}/c/ci.wasm`], { cwd: `${R}/c` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'hi from cimport 42\n', `#1061 the @cImport program runs: ${out(r)}`);

  r = await detached('tc', 'zig translate-c -target wasm32-wasi api.h', `${R}/c`);
  assert.equal(r.status, 0, `#1061 zig translate-c: ${out(r)}`);
  assert.match(r.stdout, /pub extern fn add_two\(a: c_int, b: c_int\) c_int;/, `#1061 translate-c declares the function: ${out(r)}`);
  assert.match(r.stdout, /pub const struct_point = extern struct/, `#1061 and the struct: ${out(r)}`);
  assert.match(r.stdout, /pub const LIMIT = @as\(c_int, 10\);/, `#1061 and the macro: ${out(r)}`);

  r = await detached('cxx', 'zig c++ -target wasm32-wasi -O2 e.cpp -o e.wasm', `${R}/x`);
  assert.equal(r.status, 0, `#1062 zig c++ without -fno-exceptions links: ${out(r)}`);
  assert.doesNotMatch(r.stderr, /__cxa_throw|__cxa_allocate_exception/, `#1062 ${out(r)}`);
  r = await run([`${R}/x/e.wasm`], { cwd: `${R}/x` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, '1\n', `#1062 std::map::at works: ${out(r)}`);
  console.log('cimport: @cImport and translate-c work; zig c++ links without -fno-exceptions');
}
