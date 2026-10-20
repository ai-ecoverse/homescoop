export default async function (ctx) {
  const { pty, assert } = ctx;
  for (const [loop, done] of [
    ['i=0; while ((i<50000000)); do ((i++)); done; echo after=$i', /after=/],
    ['while :; do :; done; echo after-forever', /after-forever/],
  ]) {
    const r = await pty(['bash', '--norc', '-i'], {
      steps: [
        { expect: '[$#] ' },
        { write: `${loop}\r` },
        { expect: 'done; echo after', timeoutMs: 5000 },
        { sleepMs: 300, write: '\x03' },
        { expect: '[$#] ', timeoutMs: 5000 },
        { write: 'echo "ok=$((6*7))"\r' },
        { expect: 'ok=42', timeoutMs: 5000 },
        { expect: '[$#] ', timeoutMs: 5000 },
        { write: 'exit 0\r' },
      ],
      timeoutMs: 15000,
    });
    assert.ok(!r.failedStep, `${loop}: a ^C 300 ms in didn't bring bash back to its prompt: step ${JSON.stringify(r.failedStep)}\n${JSON.stringify(r.out.slice(-400))}`);
    assert.doesNotMatch(r.out.split('done; echo after').pop(), done, `${loop}: the loop ran to its end and the command after it ran: ${JSON.stringify(r.out.slice(-400))}`);
    assert.equal(r.status, 0, `${loop}: bash exited ${r.status}`);
  }
  console.log('builtin-loop-sigint: a ^C 300 ms into a loop of builtins (an arithmetic loop to 50000000, while :) returns bash to its prompt; nothing after the loop runs; bash reads the next line');
}
