const PREVIEW1 = /^(args_|environ_|clock_|fd_|path_|poll_oneoff|proc_exit|proc_raise|sched_yield|random_get|sock_)/;

const FILES = {
  'hello/hello.zig': [
    'const std = @import("std");',
    'pub fn main(init: std.process.Init) !void {',
    '    _ = init;',
    '    std.debug.print("hello from zig\\n", .{});',
    '}',
    '',
  ].join('\n'),
  'c/hello.c': '#include <stdio.h>\n#include <string.h>\nint main(int argc, char **argv) { printf("hello from zig cc, argc=%d len=%zu\\n", argc, strlen(argv[0]) > 0 ? (size_t)5 : (size_t)0); return 3; }\n',
  'cxx/hello.cpp': '#include <iostream>\n#include <vector>\n#include <numeric>\nint main() { std::vector<int> v(10); std::iota(v.begin(), v.end(), 1); std::cout << "sum=" << std::accumulate(v.begin(), v.end(), 0) << std::endl; return 0; }\n',
  'proj/build.zig': [
    'const std = @import("std");',
    'pub fn build(b: *std.Build) void {',
    '    const target = b.standardTargetOptions(.{});',
    '    const optimize = b.standardOptimizeOption(.{});',
    '    const mod = b.createModule(.{ .root_source_file = b.path("src/main.zig"), .target = target, .optimize = optimize });',
    '    const exe = b.addExecutable(.{ .name = "app", .root_module = mod });',
    '    b.installArtifact(exe);',
    '    const tests = b.addTest(.{ .root_module = mod });',
    '    const t = b.step("test", "run tests");',
    '    t.dependOn(&b.addRunArtifact(tests).step);',
    '}',
    '',
  ].join('\n'),
  'proj/src/main.zig': [
    'const std = @import("std");',
    'fn triangle(n: u64) u64 { var s: u64 = 0; var i: u64 = 1; while (i <= n) : (i += 1) s += i; return s; }',
    'pub fn main() !void { std.debug.print("triangle={d}\\n", .{triangle(12)}); }',
    'test "triangle" { try std.testing.expectEqual(@as(u64, 78), triangle(12)); }',
    '',
  ].join('\n'),
};

function sections(bytes) {
  const ids = [];
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at++];
    let size = 0, shift = 0, b;
    do { b = bytes[at++]; size |= (b & 127) << shift; shift += 7; } while (b & 128);
    ids.push(id);
    at += size;
  }
  return ids;
}

export default async function (ctx) {
  const { run, write, readBytes, assert } = ctx;
  const R = '/home/zc';
  for (const [path, text] of Object.entries(FILES)) await write(`home/zc/${path}`, text);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const ok = async (argv, cwd) => {
    const r = await run(argv, { cwd });
    assert.equal(r.status, 0, `${argv.join(' ')}: ${out(r)}`);
    return r;
  };
  const sizes = {};
  const imports = {};
  const inspect = async (name, path) => {
    const bytes = await readBytes(path.slice(1));
    assert.ok(bytes && bytes.length, `${path} written`);
    sizes[name] = bytes.length;
    const mod = new WebAssembly.Module(bytes);
    const list = WebAssembly.Module.imports(mod);
    imports[name] = [...new Set(list.map((i) => `${i.module}.${i.name}`))].sort();
    assert.deepEqual(list.filter((i) => i.module !== 'wasi_snapshot_preview1' || !PREVIEW1.test(i.name)), [], `${name}: preview1 imports only: ${imports[name].join(',')}`);
    assert.ok(!sections(bytes).includes(8), `${name}: no start section`);
    assert.ok(WebAssembly.Module.exports(mod).some((e) => e.name === '_start'), `${name}: exports _start`);
  };

  let r = await ok(['zig', 'version'], R);
  assert.equal(r.stdout, '0.16.0\n');

  await ok(['zig', 'build-exe', 'hello.zig', '-target', 'wasm32-wasi', '-OReleaseSmall'], `${R}/hello`);
  r = await run([`${R}/hello/hello.wasm`], { cwd: `${R}/hello` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'hello from zig\n', out(r));
  await inspect('zig-hello', `${R}/hello/hello.wasm`);

  await ok(['zig', 'cc', '-target', 'wasm32-wasi', '-O2', 'hello.c', '-o', 'hello.wasm'], `${R}/c`);
  r = await run([`${R}/c/hello.wasm`, 'x'], { cwd: `${R}/c` });
  assert.equal(r.status, 3, out(r));
  assert.equal(r.stdout, 'hello from zig cc, argc=2 len=5\n', out(r));
  await inspect('cc-hello', `${R}/c/hello.wasm`);

  await ok(['zig', 'c++', '-target', 'wasm32-wasi', '-O2', '-fno-exceptions', 'hello.cpp', '-o', 'hello.wasm'], `${R}/cxx`);
  r = await run([`${R}/cxx/hello.wasm`], { cwd: `${R}/cxx` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'sum=55\n', out(r));
  await inspect('cxx-hello', `${R}/cxx/hello.wasm`);

  await ok(['zig', 'build', '-Dtarget=wasm32-wasi', '-Doptimize=ReleaseSafe'], `${R}/proj`);
  r = await run([`${R}/proj/zig-out/bin/app.wasm`], { cwd: `${R}/proj` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, 'triangle=78\n', out(r));
  await inspect('build-app', `${R}/proj/zig-out/bin/app.wasm`);
  r = await run(['zig', 'build', 'test', '-Dtarget=wasm32-wasi'], { cwd: `${R}/proj` });
  assert.equal(r.status, 0, `zig build test: ${out(r)}`);

  await write('home/zc/err/bad.zig', 'pub fn main() void { const x: u8 = 300; _ = x; }\n');
  r = await run(['zig', 'build-exe', 'bad.zig', '-target', 'wasm32-wasi'], { cwd: `${R}/err` });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /type 'u8' cannot represent integer value '300'/, out(r));

  console.log(`corpus sizes ${JSON.stringify(sizes)}`);
  console.log(`corpus imports ${JSON.stringify(imports)}`);
}
