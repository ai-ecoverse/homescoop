export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r26'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const empty = ['open', 'open creat', 'stat', 'lstat', 'access', 'mkdir', 'rmdir', 'unlink', 'chmod', 'chown', 'truncate', 'rename from', 'rename to', 'link', 'symlink target', 'symlink path', 'readlink', 'chdir', 'opendir', 'realpath', 'fstatat dirfd', 'openat dirfd', 'mkdirat dirfd'];
  assert.deepEqual(r.stdout.trim().split('\n'), [
    ...empty.map((c) => `${c}: ENOENT`),
    'fstatat AT_EMPTY_PATH: 0 same=1',
    'fstatat cwd AT_EMPTY_PATH: 0 same=1',
    'stat .: 0',
    'stat /: 0',
    'access /: 0',
    'open .: 0',
    'opendir .: 0',
    'stat f: 0',
    'realpath .: 0',
    'cwd: /tmp/r26',
    'r26 done',
  ], r.stdout);
  console.log(`r26: an empty path is ENOENT for ${empty.length} calls (through the cwd and as *at(dirfd, "")); fstatat AT_EMPTY_PATH is fstat; "." and "/" work`);
}
