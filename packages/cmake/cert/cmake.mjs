// CMake in slicc-kernel as a non-root user under users enforce: -E tools,
// -P scripts with execute_process through the kernel's spawn, and a
// Unix Makefiles configure, generate and build driven by wasm-gmake, whose
// recipes call back into cmake -E and the shell. The modules come from the
// manifest's CMAKE_ROOT (the binary runs as /usr/bin/cmake), and the wasm
// carries today's shims/slicc: the credential library (homescoop#459) and
// the inherited-ignore seed (#973).
const PKG = '/node_modules/@ai-ecoverse/wasm-cmake';
const CMAKELISTS = [
  'cmake_minimum_required(VERSION 3.20)',
  'project(demo LANGUAGES NONE)',
  'set(MSG "hello" CACHE STRING "greeting")',
  'configure_file(in.txt.in "${CMAKE_BINARY_DIR}/in.txt" @ONLY)',
  'add_custom_command(OUTPUT out.txt',
  '  COMMAND ${CMAKE_COMMAND} -E copy in.txt out.txt',
  '  COMMAND ${CMAKE_COMMAND} -E echo_append "built"',
  '  DEPENDS "${CMAKE_BINARY_DIR}/in.txt")',
  'add_custom_target(all_out ALL DEPENDS out.txt)',
  '',
].join('\n');

export default async function cmake(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'builder' });
  const cwd = '/home/builder/proj';
  const run = (argv, o = {}) => ctx.run(argv, { cwd, user: 'builder', ...o });
  await ctx.write(`${cwd}/CMakeLists.txt`, CMAKELISTS);
  await ctx.write(`${cwd}/in.txt.in`, 'msg=@MSG@\n');
  await ctx.write(`${cwd}/s.cmake`, [
    'execute_process(COMMAND bash -c "echo spawned $((6*7))" OUTPUT_VARIABLE o RESULT_VARIABLE rc)',
    'string(STRIP "${o}" o)',
    'string(SHA256 h "abc")',
    'file(WRITE "${CMAKE_CURRENT_LIST_DIR}/p.out" "${o} ${rc} ${h}")',
    'message(STATUS "root=${CMAKE_ROOT}")',
    '',
  ].join('\n'));

  const v = await run(['cmake', '--version']);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^cmake version 4\.4\.3\n/);
  const e = await run(['cmake', '-E', 'echo', 'hi']);
  assert.equal(e.stdout, 'hi\n', e.stderr);

  const p = await run(['cmake', '-P', 's.cmake']);
  assert.equal(p.status, 0, `cmake -P: ${p.stdout}${p.stderr}`);
  assert.match(p.stdout, new RegExp(`-- root=${PKG}/share/cmake-4\\.4\\n`), 'CMAKE_ROOT from the manifest');
  assert.equal(await ctx.read(`${cwd}/p.out`), 'spawned 42 0 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'execute_process runs bash through the kernel');

  const cfg = await run(['cmake', '-S', '.', '-B', 'build', '-G', 'Unix Makefiles', '-DMSG=world']);
  assert.equal(cfg.status, 0, `configure: ${cfg.stdout}${cfg.stderr}`);
  assert.match(cfg.stdout, /-- Build files have been written to: \/home\/builder\/proj\/build/);
  const b = await run(['cmake', '--build', 'build']);
  assert.equal(b.status, 0, `cmake --build: ${b.stdout}${b.stderr}`);
  assert.match(b.stdout, /built/);
  assert.equal(await ctx.read(`${cwd}/build/out.txt`), 'msg=world\n');
  const again = await run(['cmake', '--build', 'build']);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /built/, 'a second build does nothing');
  const own = await run(['bash', '-c', 'stat -c %U build/out.txt build/CMakeCache.txt | sort -u']);
  assert.equal(own.stdout, 'builder\n', `files the build writes belong to builder: ${own.stdout}${own.stderr}`);

  const wasm = await ctx.readBytes(`${PKG}/bin/cmake.wasm`);
  const names = new Set(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => i.name));
  for (const want of ['slicc_cred_js', 'slicc_sig_inherited_js', 'slicc_poll_js']) {
    assert.ok(names.has(want), `cmake.wasm does not import ${want} (today's shims/slicc)`);
  }
  console.log('cmake: --version 4.4.3, -E echo, -P with execute_process(bash) and the manifest CMAKE_ROOT, a Unix Makefiles configure + build + no-op rebuild through gmake as builder; cmake.wasm imports slicc_cred_js, slicc_sig_inherited_js, slicc_poll_js');
}
