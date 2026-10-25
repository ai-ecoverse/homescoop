import { createHash } from 'node:crypto';

const DECOY_CA = `-----BEGIN CERTIFICATE-----
MIIBejCCASCgAwIBAgIUVTMLtKUXhLNhIhmQiIQ8WMhSLNwwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXaG9tZXNjb29wIGNlcnQgZGVjb3kgQ0EwIBcNMjYxMDA5MTcw
OTM3WhgPMjEyNjA5MTUxNzA5MzdaMCIxIDAeBgNVBAMMF2hvbWVzY29vcCBjZXJ0
IGRlY295IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/TMSJELEOITBRPuB
cmBf4meqXUgzoCELxJOs3hlV1QJHijgmPmrut4eak18G7RdYdY4mFKLGkjVVUrjy
R5LWaqMyMDAwHQYDVR0OBBYEFP0MmyVlQ8xDflSyX1HrBR56yoZCMA8GA1UdEwEB
/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAPgov50uSXyN4V+xve6j+J4Vj0Jm
2kTV6HVbVm4c1XnCAiA7+Rd3tWEZR14eORFRylER2Q7RXS2nywUx+ePgmISgrg==
-----END CERTIFICATE-----
`;

const BODY = 'downloaded by cmake over https\n';

function tarball() {
  const enc = new TextEncoder();
  const files = [
    ['dep/CMakeLists.txt', 'message(STATUS "dep configured from ${CMAKE_CURRENT_SOURCE_DIR}")\nset(DEP_VIA_HTTPS yes PARENT_SCOPE)\n'],
    ['dep/data.txt', 'fetched over https\n'],
  ];
  const blocks = [];
  for (const [name, text] of files) {
    const data = enc.encode(text);
    const h = new Uint8Array(512);
    const put = (s, off) => h.set(enc.encode(s), off);
    put(name, 0);
    put('0000644\0', 100);
    put('0000000\0', 108);
    put('0000000\0', 116);
    put(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    put('00000000000\0', 136);
    put('        ', 148);
    put('0', 156);
    put('ustar\0', 257);
    put('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    put(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h);
    const pad = new Uint8Array(Math.ceil(data.length / 512) * 512);
    pad.set(data);
    blocks.push(pad);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export default async function https(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'builder' });
  const cwd = '/home/builder/tls';
  const run = (argv, env) => ctx.run(argv, { cwd, user: 'builder', ...(env && { env }) });
  const responder = new Function('req', `
    const tarball = ${tarball.toString()};
    const p = new URL(req.url).pathname;
    if (p === '/f.txt') return { headers: [['content-type', 'text/plain']], body: ${JSON.stringify(BODY)} };
    if (p === '/dep.tar') return { headers: [['content-type', 'application/x-tar']], body: tarball() };
    return { status: 404, headers: [['content-type', 'text/plain']], body: 'no\\n' };
  `);
  await ctx.serve(responder);
  const tarSha = createHash('sha256').update(tarball()).digest('hex');
  const bodySha = createHash('sha256').update(BODY).digest('hex');

  await ctx.write(`${cwd}/decoy.pem`, DECOY_CA);
  await ctx.write(`${cwd}/dl.cmake`, [
    'message(STATUS "verify [${CMAKE_TLS_VERIFY}] [$ENV{CMAKE_TLS_VERIFY}] cainfo [${CMAKE_TLS_CAINFO}]")',
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/f.txt STATUS s)',
    'file(SHA256 ${CMAKE_CURRENT_LIST_DIR}/f.txt h)',
    'message(STATUS "https ${s} ${h}")',
    '',
  ].join('\n'));
  await ctx.write(`${cwd}/untrusted.cmake`, [
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/a.txt STATUS a TLS_CAINFO ${CMAKE_CURRENT_LIST_DIR}/decoy.pem)',
    'message(STATUS "tls_cainfo ${a}")',
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/b.txt STATUS b TLS_VERIFY ON TLS_CAINFO ${CMAKE_CURRENT_LIST_DIR}/decoy.pem)',
    'message(STATUS "verify_on ${b}")',
    'set(CMAKE_TLS_CAINFO ${CMAKE_CURRENT_LIST_DIR}/decoy.pem)',
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/c.txt STATUS c)',
    'message(STATUS "cmake_tls_cainfo ${c}")',
    'file(DOWNLOAD https://cert.test/f.txt ${CMAKE_CURRENT_LIST_DIR}/d.txt STATUS d TLS_VERIFY OFF)',
    'file(SHA256 ${CMAKE_CURRENT_LIST_DIR}/d.txt dh)',
    'message(STATUS "verify_off ${d} ${dh}")',
    '',
  ].join('\n'));
  await ctx.write(`${cwd}/proj/CMakeLists.txt`, [
    'cmake_minimum_required(VERSION 3.30)',
    'project(fetch LANGUAGES NONE)',
    'include(FetchContent)',
    `FetchContent_Declare(dep URL https://cert.test/dep.tar URL_HASH SHA256=${tarSha})`,
    'FetchContent_MakeAvailable(dep)',
    'file(READ ${dep_SOURCE_DIR}/data.txt d)',
    'message(STATUS "fetched [${DEP_VIA_HTTPS}] ${d}")',
    '',
  ].join('\n'));

  const env = await run(['printenv', 'SSL_CERT_FILE']);
  assert.equal(env.status, 0, `the kernel sets SSL_CERT_FILE: ${env.stdout}${env.stderr}`);
  const kernelCa = env.stdout.trim();

  const dl = await run(['cmake', '-P', 'dl.cmake']);
  assert.equal(dl.status, 0, `cmake -P dl.cmake: ${dl.stdout}${dl.stderr}`);
  assert.match(dl.stdout, /-- verify \[\] \[\] cainfo \[\]\n/, `no TLS setting is made, so CMake's defaults apply: ${dl.stdout}`);
  assert.match(dl.stdout, new RegExp(`-- https 0;"No error" ${bodySha}\\n`), `file(DOWNLOAD https://…) with verification on, through SSL_CERT_FILE (homescoop#1280): ${dl.stdout}`);
  assert.equal(await ctx.read(`${cwd}/f.txt`), BODY);

  const fc = await run(['cmake', '-S', 'proj', '-B', 'proj/b']);
  assert.equal(fc.status, 0, `FetchContent with URL https://… (homescoop#1280): ${fc.stdout}${fc.stderr}`);
  assert.match(fc.stdout, /-- fetched \[yes\] fetched over https\n/, `FetchContent_MakeAvailable unpacked and added the https archive: ${fc.stdout}`);

  const bad = await run(['cmake', '-P', 'untrusted.cmake']);
  assert.equal(bad.status, 0, `cmake -P untrusted.cmake: ${bad.stdout}${bad.stderr}`);
  for (const row of ['tls_cainfo', 'verify_on', 'cmake_tls_cainfo']) {
    assert.match(bad.stdout, new RegExp(`-- ${row} 60;"SSL peer certificate or SSH remote key was not OK`), `${row}: an untrusted certificate fails verification: ${bad.stdout}`);
  }
  assert.match(bad.stdout, new RegExp(`-- verify_off 0;"No error" ${bodySha}\\n`), `TLS_VERIFY OFF skips verification: ${bad.stdout}`);

  const sslDecoy = await run(['cmake', '-P', 'dl.cmake'], { SSL_CERT_FILE: `${cwd}/decoy.pem` });
  assert.match(sslDecoy.stdout, /-- https 60;"SSL peer certificate or SSH remote key was not OK/, `SSL_CERT_FILE names the CA cmake trusts: ${sslDecoy.stdout}${sslDecoy.stderr}`);

  const viaCainfo = await run(['cmake', `-DCMAKE_TLS_CAINFO=${kernelCa}`, '-P', 'dl.cmake'], { SSL_CERT_FILE: `${cwd}/decoy.pem` });
  assert.match(viaCainfo.stdout, new RegExp(`-- https 0;"No error" ${bodySha}\\n`), `CMAKE_TLS_CAINFO wins over SSL_CERT_FILE: ${viaCainfo.stdout}${viaCainfo.stderr}`);

  const curlOnly = await run(['cmake', '-P', 'dl.cmake'], { SSL_CERT_FILE: '', CURL_CA_BUNDLE: kernelCa });
  assert.match(curlOnly.stdout, /-- https 60;"SSL peer certificate or SSH remote key was not OK/, `cmake does not read CURL_CA_BUNDLE, so without SSL_CERT_FILE nothing is trusted: ${curlOnly.stdout}${curlOnly.stderr}`);

  const fcBad = await run(['cmake', '-S', 'proj', '-B', 'proj/bad'], { SSL_CERT_FILE: `${cwd}/decoy.pem` });
  assert.notEqual(fcBad.status, 0, `FetchContent from an untrusted server fails the configure: ${fcBad.stdout}${fcBad.stderr}`);
  assert.doesNotMatch(fcBad.stdout, /-- fetched/, fcBad.stdout);

  console.log(`https: file(DOWNLOAD) and FetchContent over https verify against the kernel CA (SSL_CERT_FILE=${kernelCa}); a decoy CA through TLS_CAINFO, CMAKE_TLS_CAINFO or SSL_CERT_FILE gives 60, TLS_VERIFY OFF accepts it, -DCMAKE_TLS_CAINFO overrides SSL_CERT_FILE; CURL_CA_BUNDLE alone (SSL_CERT_FILE empty) gives 60`);
}
