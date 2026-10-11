export default async function (ctx) {
  const { run, assert, kernel } = ctx;
  await run(['mkdir', '-p', '/tmp/r24l']);
  await kernel.mount({ type: 'tmpfs', source: 'none', target: '/tmp/r24l' });
  const r = await run(['r24link'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'link abs: 0 file same=1',
    'linkat cwd rel: 0 file same=1',
    'linkat cwd abs: 0 file same=1',
    'linkat follow: 0 file same=1',
    'linkat dirfd/cwd: 0 file same=1',
    'linkat cwd/dirfd: 0 file same=1',
    'nlink=7',
    'r24link done',
  ], r.stdout);
  await kernel.umount('/tmp/r24l');
  console.log('r24link: on a tmpfs mount, linkat with AT_FDCWD (relative and absolute), AT_SYMLINK_FOLLOW, and dirfd on either side all link the same inode');
}
