/**
 * wasix-openssh 10.6.0-6 (wasix-sysroot -21 per-fd TIOCGWINSZ, built on
 * -22): resizing the local terminal reaches the remote pty. ssh's SIGWINCH
 * handler reads the new size and sends a window-change request; the remote
 * `stty size` after the resize must report it.
 */
export default async function winsize(ctx) {
  const { pty, assert, hostUser } = ctx;
  const t = await pty(
    ['ssh', '-t', '-o', 'BatchMode=yes', `${hostUser}@sshd.cert.internal`, 'stty size; echo ready; read x; stty size; echo done'],
    {
      cols: 80,
      rows: 24,
      steps: [
        { expect: '24 80' },
        { expect: 'ready' },
        { resize: [120, 40] },
        { sleepMs: 1000 },
        { write: '\r' },
        { expect: 'done', timeoutMs: 10000 },
      ],
      timeoutMs: 15000,
    },
  );
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  assert.match(t.out, /ready[\s\S]*40 120[\s\S]*done/, `remote size after resize to 120x40:\n${t.out}`);
  console.log('winsize: 80x24 → resize 120x40 → remote stty size 40 120');
}
