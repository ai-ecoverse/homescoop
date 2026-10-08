/**
 * bash checklist: exec keeps the pid (slicc-kernel#99). Needs slicc-kernel
 * ≥ 1.17.3: Module.sliccKernel.execve, and /proc/self for exec'd images
 * (#108). Older kernels give the exec'd image a pid of its own, so `exec`
 * changes $$ and these cases fail.
 */
const stat = (text) => {
  const m = /^(\d+) \((.*)\) (\S) (\d+) /.exec(text);
  return m && { pid: m[1], comm: m[2], ppid: m[4] };
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (script, ...args) => run(['bash', ...args, '-c', script], { cwd: '/home' });

  const hi = await sh('echo "hello $((6 * 7))"');
  assert.equal(hi.status, 0, `bash -c stderr=${hi.stderr}`);
  assert.equal(hi.stdout, 'hello 42\n');

  // A bash exec'd from bash keeps $$ and $PPID, and /proc agrees: the pid
  // shows the new image. (Before #99 its getpid() was one past /proc's.)
  const nested = await sh(
    'echo $$ $PPID; exec bash -c "echo \\$\\$ \\$PPID; cat /proc/\\$\\$/stat; true"',
  );
  assert.equal(nested.status, 0, `exec bash stderr=${nested.stderr}`);
  const [outer, inner, line] = nested.stdout.split('\n');
  assert.equal(inner, outer, `exec bash: $$/$PPID ${inner} != ${outer}`);
  const st = stat(line);
  assert.ok(st, `no /proc/<pid>/stat line in ${JSON.stringify(nested.stdout)}`);
  assert.equal(st.pid, outer.split(' ')[0]);
  assert.equal(st.comm, 'bash');

  // An exec'd coreutils cat shows under bash's pid in /proc.
  const cat = await sh('echo $$; exec cat /proc/$$/stat');
  assert.equal(cat.status, 0, `exec cat stderr=${cat.stderr}`);
  const [pid, catLine] = cat.stdout.split('\n');
  assert.equal(stat(catLine)?.comm, 'cat', `/proc/${pid}/stat after exec cat: ${catLine}`);

  // /proc/self in an exec'd image is the image under $$ (slicc-kernel#108:
  // 1.17.1/1.17.2 answered ESRCH for execve-path processes).
  const procSelf = await sh('echo $$; exec cat /proc/self/stat');
  assert.equal(procSelf.status, 0, `exec cat /proc/self/stat stderr=${procSelf.stderr}`);
  const [selfPid, selfLine] = procSelf.stdout.split('\n');
  const selfStat = stat(selfLine);
  assert.ok(selfStat, `no /proc/self/stat line in ${JSON.stringify(procSelf.stdout)}`);
  assert.equal(selfStat.pid, selfPid, `/proc/self is ${selfStat.pid}, $$ was ${selfPid}`);
  assert.equal(selfStat.comm, 'cat');

  // A forked child that execs is the pid fork() returned: $! reaches the
  // program, and a signal to it ends the program, not a stale image.
  const bg = await sh(
    'bash -c "echo \\$\\$ > /tmp/hs-exec-pid; exec sleep 30" & p=$!; ' +
      'for i in 1 2 3 4 5 6 7 8 9 10; do [ -s /tmp/hs-exec-pid ] && break; sleep 0.2; done; ' +
      'echo "$p $(cat /tmp/hs-exec-pid)"; kill $p; wait $p; echo "rc=$?"',
  );
  assert.equal(bg.status, 0, `background exec stderr=${bg.stderr}`);
  const [pair, rc] = bg.stdout.trim().split('\n');
  const [bang, self] = pair.split(' ');
  assert.equal(self, bang, `child's $$ ${self} != $! ${bang}`);
  assert.equal(rc, 'rc=143', `kill $! should end sleep with SIGTERM: ${bg.stdout}`);

  // A failed exec leaves bash as it was: execfail continues, and the trap the
  // shim reset for the exec is back.
  const fail = await sh(
    'trap "echo usr1-trapped" USR1; exec /nonexistent-hs99; kill -USR1 $$; echo continued',
    '-O',
    'execfail',
  );
  assert.equal(fail.status, 0, `execfail rc=${fail.status} stderr=${fail.stderr}`);
  assert.equal(fail.stdout, 'usr1-trapped\ncontinued\n');
  assert.match(fail.stderr, /nonexistent-hs99: (not found|No such file or directory)/);

  // Without execfail a failed exec ends bash with 127.
  const fatal = await sh('exec /nonexistent-hs99; echo unreachable');
  assert.equal(fatal.status, 127, `failed exec rc=${fatal.status}`);
  assert.equal(fatal.stdout, '');
}
