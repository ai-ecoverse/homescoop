const ROW = [
  ['open real/f', '0 abc'],
  ['open ./real/f', '0 abc'],
  ['openat AT_FDCWD real/f', '0 abc'],
  ['stat real/f', '0'],
  ['fstatat AT_FDCWD real/f', '0'],
  ['access real/f', '0'],
  ['open /tmp/r43/real/f', '0 abc'],
  ['create real/g', null],
  ['realpath real/f', '/tmp/r43/real/f'],
  ['chdir real', '0'],
  ['getcwd', '/tmp/r43/real'],
  ['open f', '0 abc'],
  ['chdir ..', '0'],
  ['getcwd', '/tmp/r43'],
  ['open real/f again', '0 abc'],
];

const rows = (tag) => ROW.map(([what, want]) => `${tag}: ${what}: ${want ?? `0 ${tag}`}`);

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r43'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'chdir /tmp/r43: 0',
    ...rows('fd 3 cwd'),
    'dup2 file 3: 0',
    ...rows('dup2'),
    'dup2: fd 3 reads: xyz',
    'close 3: 0',
    ...rows('closed'),
    'reopen: fd 3',
    ...rows('reused'),
    'r43 done',
  ], r.stdout);
  const f = await run(['r43', 'fresh'], { cwd: '/tmp/r43' });
  assert.equal(f.status, 0, `${f.stdout}${f.stderr}`);
  assert.deepEqual(f.stdout.trim().split('\n'), [
    'fresh: dup2 file 3: 0',
    ...rows('fresh'),
    'r43 fresh done',
  ], f.stdout);
  console.log(`r43 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): after dup2(file, 3), close(3) and a new file landing on fd 3, relative open/openat/stat/fstatat/access/create, realpath, chdir real and back with '..', and getcwd resolve against the cwd (/tmp/r43) through the libc cwd string instead of fd 3; also with fd 3 replaced before the first chdir in a program started in /tmp/r43`);
}
