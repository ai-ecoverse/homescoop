/**
 * The pnpm shim's one retry (12.9.1-16, homescoop#1127). `pnpm` and `pn`
 * are now shims/pnpm, which runs pnpm.wasm (the pnpm-wasm command) and
 * runs it once more when it exits 134 with "wasm trap in thread N: memory
 * access out of bounds" on stderr, a false trap V8 can raise when a thread's
 * view of the shared memory lags another thread's memory.grow. Here a fake
 * stands in for pnpm.wasm (PNPM_RETRY_COMMAND): it traps on its first run
 * and succeeds on the second; another exit 134 isn't retried; stdout and
 * stderr pass through; pnpm --version and pn --version go to pnpm.wasm.
 */
const FAKE = `#!/bin/sh
n=$(cat /tmp/fake-count 2>/dev/null || echo 0); n=$((n+1)); echo $n > /tmp/fake-count
echo "fake stdout $n $*"
case "$1:$n" in
  trap:1) echo "pnpm: wasm trap in thread 4: memory access out of bounds" >&2; echo "    at somewhere (wasm://wasm/0:wasm-function[1]:0x1)" >&2; exit 134 ;;
  abort:*) echo "thread 'main' panicked at somewhere" >&2; exit 134 ;;
esac
echo "fake stderr $n" >&2
exit 0
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;
  await write('/tmp/fake-pnpm', FAKE);
  await run(['chmod', '755', '/tmp/fake-pnpm'], { cwd: '/' });

  await run(['rm', '-f', '/tmp/fake-count'], { cwd: '/' });
  const t = await run(['pnpm', 'trap', 'x'], { cwd: '/tmp', env: { PNPM_RETRY_COMMAND: '/tmp/fake-pnpm' } });
  assert.equal(t.status, 0, `a false trap is retried once and the retry's status is pnpm's: ${out(t)}`);
  assert.match(t.stdout, /^fake stdout 1 trap x$/m, out(t));
  assert.match(t.stdout, /^fake stdout 2 trap x$/m, out(t));
  assert.match(t.stderr, /^pnpm: wasm trap in thread 4: memory access out of bounds$/m, out(t));
  assert.match(t.stderr, /^pnpm: retrying once after a false trap \(homescoop#1127\): wasm trap in thread 4: memory access out of bounds$/m, out(t));
  assert.match(t.stderr, /^fake stderr 2$/m, out(t));

  await run(['rm', '-f', '/tmp/fake-count'], { cwd: '/' });
  const a = await run(['pn', 'abort'], { cwd: '/tmp', env: { PNPM_RETRY_COMMAND: '/tmp/fake-pnpm' } });
  assert.equal(a.status, 134, `another exit 134 (a panic) is not retried: ${out(a)}`);
  assert.doesNotMatch(a.stderr, /retrying/, out(a));
  assert.doesNotMatch(a.stdout, /fake stdout 2/, out(a));

  for (const cmd of ['pnpm', 'pn']) {
    const v = await run([cmd, '--version'], { cwd: '/tmp' });
    assert.equal(v.status, 0, out(v));
    assert.equal(v.stdout, '12.9.1\n', `${cmd} --version runs pnpm.wasm through the shim: ${out(v)}`);
  }
  console.log('retry: a false trap is retried once; a panic is not; pnpm/pn reach pnpm.wasm');
}
