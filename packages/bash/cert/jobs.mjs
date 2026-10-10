/**
 * wasm-bash 5.3.0-11: ^C and ^Z typed right after Enter reach the new job,
 * 20 times each. Since 5.3.0-8 (emscripten 4.0.23) the forked child, a new
 * kernel worker, took the terminal tens of milliseconds after fork() had
 * returned in the shell, and a ^C or ^Z typed in that window went to the
 * shell's own process group and was lost: the job kept running (slicc-kernel
 * test/unit/terminal.test.mjs, #240's tests). jobs-parent-terminal.patch
 * lets the shell give the terminal to the new foreground job as well.
 * Each stopped job then gets `kill -KILL %1` (no SIGCONT) and must be
 * reported "Killed" (5.3.0-12): jobs-notify-unqueue.patch lets notify_of_job_status reap
 * a SIGCHLD that arrives while it prints, instead of leaving the job
 * "Stopped" until the shell's next fork.
 */
export default async function (ctx) {
  const { pty, assert } = ctx;
  const N = 20;
  const steps = [{ expect: '[$#] ' }];
  for (let i = 0; i < N; i++) {
    steps.push(
      { write: 'sleep 30\r' },
      { expect: 'sleep 30\r\n' },
      { write: '\x03' },
      { expect: '[$#] ', timeoutMs: 5000 },
      { write: `echo "c${i}=$?"\r` },
      { expect: `c${i}=130`, timeoutMs: 5000 },
    );
  }
  for (let i = 0; i < N; i++) {
    steps.push(
      { write: 'sleep 30\r' },
      { expect: 'sleep 30\r\n' },
      { write: '\x1a' },
      { expect: 'Stopped', timeoutMs: 5000 },
      { write: 'kill -KILL %1\r' },
      { expect: 'Killed', timeoutMs: 5000 },
      { write: `echo "z${i}=$((6*7))"\r` },
      { expect: `z${i}=42`, timeoutMs: 5000 },
    );
  }
  steps.push({ write: 'jobs; echo "jobs: $(jobs | wc -l) left"\r' }, { expect: 'jobs: 0 left' }, { write: 'exit 0\r' });
  const r = await pty(['bash', '--norc', '-i'], { steps, timeoutMs: 180000 });
  assert.ok(!r.failedStep, `step ${JSON.stringify(r.failedStep)}\n${JSON.stringify(r.out.slice(-600))}`);

  // The first job of a fresh session, stopped right after Enter, is the
  // current job: `jobs -l` marks it '+', and plain `fg` resumes it (5.3.0-12;
  // its first build stopped it twice through the fork-time recorder).
  for (let i = 0; i < 5; i++) {
    const f = await pty(['bash', '--norc', '-i'], {
      steps: [
        { expect: '[$#] ' },
        { write: 'sleep 30\r' },
        { expect: 'sleep 30\r\n' },
        { write: '\x1a' },
        { expect: 'Stopped', timeoutMs: 5000 },
        { write: 'jobs -l\r' },
        { expect: '\\[1\\]\\+ +\\d+ Stopped', timeoutMs: 5000 },
        { write: 'fg\r' },
        { expect: 'sleep 30\r\n', timeoutMs: 5000 },
        { sleepMs: 200, write: '\x03' },
        { write: 'echo "j$((1+1))=$(jobs | wc -l)"\r' },
        { expect: 'j2=0', timeoutMs: 5000 },
        { write: 'exit 0\r' },
      ],
      timeoutMs: 30000,
    });
    assert.ok(!f.failedStep, `first job, session ${i}: step ${JSON.stringify(f.failedStep)}\n${JSON.stringify(f.out.slice(-500))}`);
  }

  // A ^Z typed while a builtin waits belongs to the shell, which ignores it:
  // it does not stop the next job of the line (5.3.0-12's first build gave
  // "[1] Stopped sleep 1" and rs=148).
  const b = await pty(['bash', '--norc', '-i'], {
    steps: [
      { expect: '[$#] ' },
      { write: 'read x; sleep 1; echo "rs=$?"\r' },
      { expect: 'echo "rs=\\$\\?"\r\n' },
      { sleepMs: 150, write: '\x1a' },
      { sleepMs: 150, write: 'hello\r' },
      { expect: 'rs=\\d+', timeoutMs: 8000 },
      { write: 'exit 0\r' },
    ],
    timeoutMs: 30000,
  });
  assert.ok(!b.failedStep, `builtin ^Z: step ${JSON.stringify(b.failedStep)}\n${JSON.stringify(b.out.slice(-500))}`);
  assert.match(b.out, /rs=0/, `builtin ^Z: ${JSON.stringify(b.out.slice(-300))}`);
  assert.doesNotMatch(b.out, /Stopped/, `builtin ^Z stopped a job: ${JSON.stringify(b.out.slice(-300))}`);
}
