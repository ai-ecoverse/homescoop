import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ppoll(ctx) {
  const { pty, run, assert, hostUser, pkgDir } = ctx;
  const ssh = readFileSync(join(pkgDir, 'bin', 'ssh.wasm'));
  assert.equal(ssh.includes('homescoop_compat_ppoll'), false, 'ssh.wasm still carries the openbsd-compat ppoll (10.6.0-7)');
  assert.match(ssh.toString('latin1'), /wasix-sysroot 2025\.9\.30-(29|[3-9]\d)/, 'ssh.wasm is not linked against wasix-sysroot >= -29');

  const t0 = Date.now();
  const late = await run(['ssh', '-o', 'BatchMode=yes', `${hostUser}@sshd.cert.internal`, 'sleep 2; echo late']);
  const lateMs = Date.now() - t0;
  assert.equal(late.status, 0, `rc=${late.status} stderr=${late.stderr}`);
  assert.equal(late.stdout.trim(), 'late');
  assert.equal(late.stderr.includes('poll'), false, `stderr: ${late.stderr}`);
  assert.ok(lateMs < 15000, `a 2 s remote sleep took ${lateMs} ms`);

  const t = await pty(
    ['ssh', '-t', '-o', 'BatchMode=yes', `${hostUser}@sshd.cert.internal`, 'trap "stty size; echo winch" WINCH; echo ready; while :; do sleep 0.2; done'],
    {
      cols: 80,
      rows: 24,
      steps: [
        { expect: 'ready', timeoutMs: 15000 },
        { sleepMs: 1500 },
        { resize: [132, 50] },
        { expect: '50 132', timeoutMs: 3000 },
        { write: '\x03' },
      ],
      timeoutMs: 25000,
    },
  );
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  console.log(`ppoll: ssh.wasm uses the libc ppoll (no homescoop_compat_ppoll, sysroot >= -29); a 2 s remote sleep returns 'late' in ${lateMs} ms with no poll error; an idle ssh -t session (events-0 pollfds, signals blocked outside ppoll) wakes on SIGWINCH and the remote sees 50 132 within 3 s`);
}
