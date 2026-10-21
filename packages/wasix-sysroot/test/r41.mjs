export default async function (ctx) {
  const { run, assert } = ctx;
  const gone = process.env.R41_GONE === '1';
  const kernelCwd = process.env.R41_KERNEL === '1';
  const r = await run(['r41'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const live = [
    'chdir /tmp/r41: 0',
    'mkdir d: 0',
    'chdir d: 0',
    'getcwd: /tmp/r41/d',
    'stat f: 0',
    'stat f is /tmp/r41/d/f: 1',
    'fstatat AT_FDCWD f: 0',
    'access ./f: 0',
    'openat AT_FDCWD ./f: 0 abc',
    'mkdir sub: 0',
    'chdir sub: 0',
    'getcwd: /tmp/r41/d/sub',
    'chdir ..: 0',
    'getcwd: /tmp/r41/d',
    'chdir ./sub/../..: 0',
    'getcwd: /tmp/r41',
    'realpath d/f: /tmp/r41/d/f',
    'readdir .: 1 d',
    'chdir d: 0',
    'rmdir /tmp/r41/d: 0',
    'rename n d: 0',
  ];
  assert.deepEqual(lines.slice(0, live.length), live, r.stdout);
  const rest = lines.slice(live.length);
  let verdict = 'live cwd only (R41_GONE unset)';
  if (gone) {
    const getcwdLine = rest[6];
    assert.ok(kernelCwd ? getcwdLine === 'gone: getcwd: ENOENT' : ['gone: getcwd: ENOENT', 'gone: getcwd: /tmp/r41/d'].includes(getcwdLine), r.stdout);
    assert.ok(['gone: readdir .: ENOENT', 'gone: readdir .: 0'].includes(rest[0]), r.stdout);
    assert.deepEqual([...rest.slice(1, 6), ...rest.slice(7)], [
      'gone: open x: ENOENT',
      'gone: stat x: ENOENT',
      'gone: fstatat AT_FDCWD x: ENOENT',
      'gone: access x: ENOENT',
      'gone: chdir x: ENOENT',
      'gone: chdir ..: 0',
      'getcwd: /tmp/r41',
      'open d/x: 0 new',
      'r41 done',
    ], r.stdout);
    verdict = `removed cwd: ${rest[0]}; x, stat, fstatat, access, chdir ENOENT; ${getcwdLine}; chdir("..") lands in /tmp/r41`;
  } else {
    assert.equal(rest.at(-1), 'r41 done', r.stdout);
  }
  console.log(`r41 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): relative open/stat/fstatat/openat/access, mkdir, chdir sub/../.. and realpath through the cwd fd; ${verdict}`);
}
