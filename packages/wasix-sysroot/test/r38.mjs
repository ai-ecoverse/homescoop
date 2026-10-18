// -37: Linux's S_IF* values (homescoop#1015) and device permissions (#1112).
const WANT = [
  'S_IFMT=170000 S_IFSOCK=140000 S_IFLNK=120000 S_IFREG=100000 S_IFBLK=060000 S_IFDIR=040000 S_IFCHR=020000 S_IFIFO=010000',
  'regular: reg type=100000 mode=100644',
  'directory: dir type=040000 mode=040755',
  /^symlink: lnk type=120000 mode=120\d{3}$/,
  /^pipe: fifo type=010000 mode=010\d{3}$/,
  /^socket: sock type=140000 mode=140\d{3}$/,
  '/dev/null: chr type=020000 mode=020666',
  '/dev/zero: chr type=020000 mode=020666',
  'fstat /dev/null: chr type=020000 mode=020666',
  'r38 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r38'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, WANT.length, r.stdout);
  WANT.forEach((w, i) => (w instanceof RegExp ? assert.match(lines[i], w, r.stdout) : assert.equal(lines[i], w, r.stdout)));
  // The same bits as coreutils' stat (Emscripten, kernel-side) for the devices and the pipe.
  const c = await run(['bash', '-c', 'stat -c %f /dev/null /dev/zero; echo x | stat -c %f -'], { cwd: '/tmp' });
  assert.deepEqual(c.stdout.trim().split('\n'), ['21b6', '21b6', '1180'], `coreutils: ${c.stdout}${c.stderr}`);
  console.log(`r38 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): S_IF* are Linux's (S_IFMT 0170000, S_IFIFO 0010000, S_IFSOCK 0140000), stat gives each type's Linux bits, and /dev/null and /dev/zero are 020666 by path and by descriptor, as coreutils reports`);
}
