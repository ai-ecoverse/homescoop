const PKG = '/node_modules/@ai-ecoverse/wasm-git';
const BUILD_PATH = /\/(?:home|Users|__w|private\/var|var\/folders)\/[\x21-\x7e]{0,80}|homescoop-work[\x21-\x7e]{0,60}|\.homescoop-out[\x21-\x7e]{0,60}/;
const CURL_LINKED = ['bin/git-remote-http.wasm', 'bin/git-remote-https.wasm', 'libexec/git-core/git-http-fetch.wasm', 'libexec/git-core/git-remote-ftp.wasm', 'libexec/git-core/git-remote-ftps.wasm', 'libexec/git-core/git-remote-http.wasm', 'libexec/git-core/git-remote-https.wasm'];

export default async function paths(ctx) {
  const { run, assert, readBytes } = ctx;
  const ls = await run(['bash', '-c', `cd ${PKG} && printf '%s\\n' bin/*.wasm libexec/git-core/*.wasm`], { cwd: '/tmp' });
  assert.equal(ls.status, 0, ls.stderr);
  const files = ls.stdout.split('\n').filter(Boolean);
  for (const want of CURL_LINKED) assert.ok(files.includes(want), `${want} is in the package: ${files.join(' ')}`);
  assert.ok(files.length >= 15, `every wasm of the package is listed: ${files.join(' ')}`);
  const leaks = [];
  for (const f of files) {
    const bytes = await readBytes(`${PKG}/${f}`);
    assert.ok(bytes && bytes.length > 1 << 16, `${f} is not there`);
    const leak = bytes.toString('latin1').match(BUILD_PATH);
    if (leak) leaks.push(`${f}: ${leak[0]}`);
  }
  assert.deepEqual(leaks, [], `the wasm name a build path (homescoop#1008):\n${leaks.join('\n')}`);
  console.log(`git paths: none of the ${files.length} wasm names a build path; the libcurl and Mbed TLS ones (git-remote-http(s), git-http-fetch, ftp(s)) included`);
}
