import { createHash } from 'node:crypto';

const SIZE = 3 * 1024 * 1024;

export default async function downloads(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'builder' });
  const cwd = '/home/builder/dl';
  const run = (argv) => ctx.run(argv, { cwd, user: 'builder' });
  await ctx.serve(async (req) => {
    const p = new URL(req.url).pathname;
    if (p === '/big.bin') {
      const b = new Uint8Array(3 * 1024 * 1024);
      for (let i = 0; i < b.length; i++) b[i] = (i * 7 + (i >> 11)) & 255;
      return { headers: [['content-type', 'application/octet-stream']], body: b };
    }
    if (p === '/moved') return { status: 302, statusText: 'Found', headers: [['location', '/target.txt']], body: '' };
    if (p === '/target.txt') return { headers: [['content-type', 'text/plain']], body: 'after a redirect\n' };
    if (p === '/stall') {
      await new Promise((r) => setTimeout(r, 20000));
      return { headers: [['content-type', 'text/plain']], body: 'late\n' };
    }
    return { status: 404, headers: [['content-type', 'text/plain']], body: 'no\n' };
  });
  const big = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) big[i] = (i * 7 + (i >> 11)) & 255;
  const sha = createHash('sha256').update(big).digest('hex');
  await ctx.write(`${cwd}/dl.cmake`, [
    `file(DOWNLOAD http://cert.test/big.bin \${CMAKE_CURRENT_LIST_DIR}/big.bin EXPECTED_HASH SHA256=${sha} STATUS s)`,
    'list(GET s 0 code)',
    'file(SIZE ${CMAKE_CURRENT_LIST_DIR}/big.bin n)',
    'message(STATUS "big ${code} ${n}")',
    'file(DOWNLOAD http://cert.test/moved ${CMAKE_CURRENT_LIST_DIR}/moved.txt STATUS r)',
    'list(GET r 0 rcode)',
    'file(READ ${CMAKE_CURRENT_LIST_DIR}/moved.txt t)',
    'message(STATUS "redirect ${rcode} ${t}")',
    'file(DOWNLOAD http://cert.test/stall ${CMAKE_CURRENT_LIST_DIR}/stall.txt TIMEOUT 3 STATUS w)',
    'list(GET w 0 wcode)',
    'message(STATUS "timeout ${wcode}")',
    '',
  ].join('\n'));
  await ctx.write(`${cwd}/bad.cmake`, `file(DOWNLOAD http://cert.test/big.bin \${CMAKE_CURRENT_LIST_DIR}/bad.bin EXPECTED_HASH SHA256=${'0'.repeat(64)})\nmessage(STATUS "not reached")\n`);
  await ctx.write(`${cwd}/CMakeLists.txt`, 'cmake_minimum_required(VERSION 3.20)\nproject(over LANGUAGES NONE)\nmessage(STATUS "id ${CMAKE_SYSTEM_NAME} WASI=${WASI} UNIX=${UNIX}")\n');

  const dl = await run(['cmake', '-P', 'dl.cmake']);
  assert.match(dl.stdout, new RegExp(`-- big 0 ${SIZE}\\n`), `a 3 MiB binary download with EXPECTED_HASH (homescoop#1281): ${dl.stdout}${dl.stderr}`);
  const got = await ctx.readBytes(`${cwd}/big.bin`);
  assert.equal(createHash('sha256').update(got).digest('hex'), sha, 'the downloaded bytes are the served bytes');
  assert.match(dl.stdout, /-- redirect 0 after a redirect\n/, `file(DOWNLOAD) follows a 302: ${dl.stdout}`);
  assert.match(dl.stdout, /-- timeout 28\n/, `TIMEOUT 3 on a stalled server is curl's 28: ${dl.stdout}`);

  const bad = await run(['cmake', '-P', 'bad.cmake']);
  assert.notEqual(bad.status, 0, `a wrong EXPECTED_HASH fails the script: ${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /HASH mismatch/, bad.stderr);
  assert.doesNotMatch(bad.stdout, /not reached/, bad.stdout);

  const linux = await run(['cmake', '-S', '.', '-B', 'b', '-DCMAKE_SYSTEM_NAME=Linux']);
  assert.equal(linux.status, 0, `configure -DCMAKE_SYSTEM_NAME=Linux: ${linux.stdout}${linux.stderr}`);
  assert.match(linux.stdout, /-- id Linux WASI= UNIX=1\n/, `the README's -DCMAKE_SYSTEM_NAME override: ${linux.stdout}`);
  console.log('downloads: 3 MiB binary with EXPECTED_HASH, a wrong hash refused, a 302 followed, TIMEOUT 3 gives 28; -DCMAKE_SYSTEM_NAME=Linux gives UNIX=1');
}
