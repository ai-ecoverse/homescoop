export const build = { asyncify: true };

const NEW = [
  'mkfifo f1 0666 umask 022: 0 fifo 0644',
  'mkfifo f1 again: -1 File exists',
  'mkfifoat dirfd f2 0600: 0 fifo 0600',
  'mkfifoat AT_FDCWD /tmp/r34/f4: 0 fifo 0640',
  'mknod S_IFIFO f3: 0 fifo 0600',
  'mknod S_IFREG reg: 0 reg 0644',
  'mknod S_IFCHR dev: -1 Operation not permitted none',
  'mkfifo over a dangling link: -1 File exists link 0777',
  'mkfifo in a missing dir: -1 No such file or directory',
  'writer and reader meet through f1: read=5 "hello" child=0',
  'r34 done',
];
const OLD = ['mkfifo f1 0666 umask 022: -1 Function not implemented none', 'mknod S_IFIFO: -1 Function not implemented', 'r34 done (no path_mkfifo)'];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r34'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const has = !lines[0].includes('Function not implemented');
  if (process.env.R34_KERNEL === '1') assert.ok(has, `R34_KERNEL=1 but ${lines[0]}`);
  assert.deepEqual(lines, has ? NEW : OLD, r.stdout);
  console.log(`r34 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${has
    ? 'mkfifo through slicc_fs.path_mkfifo makes a FIFO (umask 022: 0666 → 0644), EEXIST for an existing name and a dangling link, ENOENT for a missing dir; mkfifoat with a dirfd and AT_FDCWD; mknod S_IFIFO is mkfifo, S_IFREG an empty file, S_IFCHR EPERM; a forked writer and a reader meet through the FIFO'
    : 'no slicc_fs.path_mkfifo: mkfifo and mknod(S_IFIFO) are ENOSYS'}`);
}
