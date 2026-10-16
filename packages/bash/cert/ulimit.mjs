/**
 * ulimit (homescoop#178): bash's limits go through the slicc shims'
 * prlimit64 (slicc_libc_gaps.c). Until 5.3.0-18 Emscripten's stub refused
 * every change, so `ulimit -S -n 64` and `ulimit -S -c 0` failed with
 * "cannot modify limit: Operation not permitted". Now a soft limit moves up
 * to its hard one, a hard limit only down (EPERM up, for root too: the
 * hard limits are what a process has, 4096 fds), a subshell (fork) keeps
 * them, and a new program (exec) starts at the defaults: slicc-kernel keeps
 * no limits to hand on. Advisory: nothing enforces them yet.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const sh = async (script, user) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
    return { ...r, all: `${script}\nrc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}` };
  };
  const script = [
    'ulimit -S -n; ulimit -H -n',
    'ulimit -S -n 64 && ulimit -S -n && ulimit -H -n',
    '( ulimit -S -n )',
    'ulimit -S -c 0 && ulimit -S -c',
    'ulimit -H -n 8192 2>&1; echo "up rc=$?"; ulimit -H -n',
    'ulimit -S -n 5000 2>&1; echo "over rc=$?"; ulimit -S -n',
    'ulimit -H -n 1024 && ulimit -H -n',
    'ulimit -n 2048 2>&1; echo "both rc=$?"; ulimit -S -n; ulimit -H -n',
    'bash -c "ulimit -S -n; ulimit -H -n"',
  ].join('\n');
  const want = [
    '4096', '4096',
    '64', '4096',
    '64',
    '0',
    'bash: line 5: ulimit: open files: cannot modify limit: Operation not permitted', 'up rc=1', '4096',
    'bash: line 6: ulimit: open files: cannot modify limit: Invalid argument', 'over rc=1', '64',
    '1024',
    'bash: line 8: ulimit: open files: cannot modify limit: Operation not permitted', 'both rc=1', '64', '1024',
    '4096', '4096',
    '',
  ].join('\n');
  for (const user of [undefined, 'cone']) {
    if (user) await addUser({ name: user });
    const r = await sh(script, user);
    assert.equal(r.status, 0, `${user ?? 'root'}: ${r.all}`);
    assert.equal(r.stdout, want, `${user ?? 'root'}: ${r.all}`);
  }
  const a = await sh('ulimit -S -n 64; ulimit -a');
  assert.equal(a.status, 0, a.all);
  assert.match(a.stdout, /^open files +\(-n\) 64$/m, a.all);
  assert.match(a.stdout, /^core file size +\(blocks, -c\) unlimited$/m, a.all);
  console.log('ulimit: -S -n 64 and -S -c 0 succeed; hard limits only go down (EPERM up, root and cone); soft over hard EINVAL; a subshell keeps them, a new bash starts at 4096');
}
