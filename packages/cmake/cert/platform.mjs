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

  const notices = await ctx.read('/node_modules/@ai-ecoverse/wasm-cmake/THIRD-PARTY-NOTICES.md');
  assert.ok(notices, 'THIRD-PARTY-NOTICES.md ships');
  for (const name of ['Emscripten 6.0.9', 'cmlibuv', 'cmlibarchive', 'cmexpat', 'cmjsoncpp', 'cmzstd', 'cmbzip2', 'cmliblzma', 'cmlibrhash', 'cmllpkgc', 'curl / libcurl 8\\.22\\.0 \\(@ai-ecoverse/wasm-curl\\)', 'Mbed TLS 3\\.6\\.5', 'zlib 1\\.3\\.1 \\(@ai-ecoverse/wasm-zlib\\)']) {
    assert.match(notices, new RegExp(`^## ${name}`, 'm'), `THIRD-PARTY-NOTICES.md names ${name} (homescoop#1279, #844, #1280)`);
  }
  for (const name of ['cmcurl', 'cmnghttp2', 'cmzlib']) {
    assert.doesNotMatch(notices, new RegExp(`^## ${name}`, 'm'), `cmake.wasm links wasm-curl and wasm-zlib, not the bundled ${name} (homescoop#1280)`);
  }
  assert.match(notices, /^## homescoop: .*\bslicc shims\b.*Apache-2\.0/m, 'THIRD-PARTY-NOTICES.md has the slicc shims section (homescoop#1533)');
  assert.match(notices.slice(notices.search(/^## homescoop: .*slicc shims/m)), /Apache License\s+Version 2\.0/, 'the slicc shims section carries the Apache-2.0 text (homescoop#1533)');
  console.log('platform: the host is WASI; file(DOWNLOAD) over http with the right bytes, a 404 is 22; THIRD-PARTY-NOTICES.md names Emscripten, the 9 bundled libraries, wasm-curl\'s curl and Mbed TLS, wasm-zlib and the slicc shims (Apache-2.0), and no cmcurl, cmnghttp2 or cmzlib');
}
