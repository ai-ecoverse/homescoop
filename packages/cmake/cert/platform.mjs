// What a project sees, and what the package says about what it contains:
// - homescoop#1278: in slicc the host is WASI (CMAKE_SYSTEM_NAME WASI, WASI=1,
//   no UNIX), as in 4.4.3-9. slicc-kernel now answers uname with
//   "Linux 6.0.0-slicc", which host-emscripten-is-wasi.patch now maps too.
// - homescoop#1280: file(DOWNLOAD) over http works through the kernel's
//   sockets (slicc_socket.c is linked), with EXPECTED_HASH. https is
//   refused with curl's "Unsupported protocol": CMake's bundled curl has no
//   TLS backend in this package (README).
// - homescoop#1279, #844: THIRD-PARTY-NOTICES.md names the Emscripten runtime
//   and every bundled library cmake.wasm links.
export default async function platform(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'builder' });
  const cwd = '/home/builder/plat';
  const run = (argv) => ctx.run(argv, { cwd, user: 'builder' });
  const body = 'downloaded by cmake\n';
  await ctx.serve(async (req) => {
    const p = new URL(req.url).pathname;
    return p === '/f.txt' ? { headers: [['content-type', 'text/plain']], body: 'downloaded by cmake\n' } : { status: 404, headers: [['content-type', 'text/plain']], body: 'no\n' };
  });
  await ctx.write(`${cwd}/CMakeLists.txt`, 'cmake_minimum_required(VERSION 3.20)\nproject(plat LANGUAGES NONE)\nmessage(STATUS "id ${CMAKE_SYSTEM_NAME} ${CMAKE_HOST_SYSTEM_NAME} ${CMAKE_HOST_SYSTEM_PROCESSOR} WASI=${WASI} UNIX=${UNIX}")\n');
  await ctx.write(`${cwd}/dl.cmake`, [
    'file(DOWNLOAD http://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/f.txt STATUS s)',
    'list(GET s 0 code)',
    'file(SHA256 ${CMAKE_CURRENT_LIST_DIR}/f.txt h)',
    'message(STATUS "http ${code} ${h}")',
    'file(DOWNLOAD http://cert.test/missing ${CMAKE_CURRENT_LIST_DIR}/m.txt STATUS m)',
    'list(GET m 0 mcode)',
    'message(STATUS "missing ${mcode}")',
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/g.txt STATUS t)',
    'message(STATUS "https ${t}")',
    '',
  ].join('\n'));

  const cfg = await run(['cmake', '-S', '.', '-B', 'b']);
  assert.equal(cfg.status, 0, `configure: ${cfg.stdout}${cfg.stderr}`);
  assert.match(cfg.stdout, /-- id WASI WASI wasm32 WASI=1 UNIX=\n/, `the host is WASI (homescoop#1278): ${cfg.stdout}`);

  const dl = await run(['cmake', '-P', 'dl.cmake']);
  assert.equal(dl.status, 0, `cmake -P dl.cmake: ${dl.stdout}${dl.stderr}`);
  const want = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(want)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.match(dl.stdout, new RegExp(`-- http 0 ${hex}\\n`), `file(DOWNLOAD http://…) (homescoop#1280): ${dl.stdout}`);
  assert.equal(await ctx.read(`${cwd}/f.txt`), body);
  assert.match(dl.stdout, /-- missing 22\n/, `a 404 is curl's 22: ${dl.stdout}`);
  assert.match(dl.stdout, /-- https 1;"Unsupported protocol"\n/, `https without a TLS backend: ${dl.stdout}`);

  const notices = await ctx.read('/node_modules/@ai-ecoverse/wasm-cmake/THIRD-PARTY-NOTICES.md');
  assert.ok(notices, 'THIRD-PARTY-NOTICES.md ships');
  for (const name of ['Emscripten 6.0.9', 'cmcurl', 'cmlibuv', 'cmlibarchive', 'cmexpat', 'cmjsoncpp', 'cmzstd', 'cmbzip2', 'cmliblzma', 'cmnghttp2', 'cmlibrhash', 'cmzlib']) {
    assert.match(notices, new RegExp(`^## ${name}`, 'm'), `THIRD-PARTY-NOTICES.md names ${name} (homescoop#1279, #844)`);
  }
  console.log('platform: the host is WASI; file(DOWNLOAD) over http with the right bytes, a 404 is 22, https is "Unsupported protocol"; THIRD-PARTY-NOTICES.md names Emscripten and the 11 bundled libraries');
}
