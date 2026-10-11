export const build = { asyncify: true, side: 'r23fork-side' };

export default async function (ctx) {
  const { run, assert, side } = ctx;
  const r = await run(['r23fork'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'child: tl=11 own_pid=1',
    'parent: child exit=7',
    'parent: tl=11',
    'parent: child exit=9',
  ], r.stdout);
  console.log(`r23fork: fork and _Fork in an asyncified ${ctx.variant} program; the child sees the parent's thread_local`);

  const s = await run(['r23fork-sync'], { cwd: '/tmp' });
  assert.equal(s.status, 1, `${s.stdout}${s.stderr}`);
  assert.equal(s.stdout.trim(), 'fork: -1 Function not implemented', s.stdout);
  console.log('r23fork-sync: without asyncify, fork() is -1 ENOSYS');
  if (!side) return;

  const d = await run(['r23fork', 'dl', side], { cwd: '/tmp' });
  assert.equal(d.status, 0, `${d.stdout}${d.stderr}`);
  const lines = d.stdout.trim().split('\n');
  if (process.env.R23_DLFORK === '1') {
    assert.deepEqual(lines, ['parent: add=6 bump=41', 'child: add=7 bump=42', 'parent: child exit=7', 'parent: add=6'], `${d.stdout}${d.stderr}`);
    console.log('r23fork dl: dlopen then fork, the child calls the side module with its thread_local carried');
    return;
  }
  assert.deepEqual(lines, ['parent: add=6 bump=41', 'parent: child exit=134', 'parent: add=6'], `${d.stdout}${d.stderr}`);
  assert.match(d.stderr, /table index is out of bounds/, d.stderr);
  console.log('r23fork dl: dlopen then fork, the child traps in the side module (slicc-kernel#337 open; R23_DLFORK=1 expects it fixed)');
}
