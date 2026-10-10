/**
 * wasix-sysroot 2025.9.30-21: test/fifo.c. PIPE_TYPE says what slicc-kernel
 * makes of a pipe: `fifo` (slicc_fs fd_mode reports S_IFIFO; r99's kernel
 * change), `socket` (WASI SOCKET_STREAM, slicc-kernel #280: 1.47.3-1.48.x),
 * or unset for unknown (fmt 0; 1.47.1), as on -20.
 * Regular files, directories, symlinks, character devices and sockets keep
 * their types either way.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['bash', '-c', 'echo x | fifo'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const pipe = {
    fifo: 'fifo=1 sock=0 reg=0 dir=0 lnk=0 chr=0 fmt=140000',
    socket: 'fifo=0 sock=1 reg=0 dir=0 lnk=0 chr=0 fmt=160000',
  }[process.env.PIPE_TYPE] ?? 'fifo=0 sock=0 reg=0 dir=0 lnk=0 chr=0 fmt=0';
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 2), [`stdin pipe: ${pipe}`, `pipe(): ${pipe}`], r.stdout);
  assert.deepEqual(lines.slice(2), [
    'file: fifo=0 sock=0 reg=1 dir=0 lnk=0 chr=0 fmt=100000',
    'stat file: fifo=0 sock=0 reg=1 dir=0 lnk=0 chr=0 fmt=100000',
    'dir: fifo=0 sock=0 reg=0 dir=1 lnk=0 chr=0 fmt=40000',
    'lstat link: fifo=0 sock=0 reg=0 dir=0 lnk=1 chr=0 fmt=120000',
    'dev null: fifo=0 sock=0 reg=0 dir=0 lnk=0 chr=1 fmt=20000',
    'socket: fifo=0 sock=1 reg=0 dir=0 lnk=0 chr=0 fmt=160000',
    'fifo done',
  ], r.stdout);
}
