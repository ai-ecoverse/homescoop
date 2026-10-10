/**
 * wasm-bash 5.3.0-14: a ^C that arrives while bash takes an accepted line
 * from readline (slicc-kernel delivers the SIGINT between two of readline's
 * one-character echo writes) must not run what is left of the line. 5.3.0-13
 * consumed the first character, threw to the top level and then ran the rest:
 * "leep 0.1 && echo ranN" -> "leep: command not found" (thr_r99i6mnbaf's
 * trace, slicc-kernel#240). readline-sigint-discard.patch drops the line.
 *
 * 20 rounds, each a fresh interactive bash in a pty: the command and Enter,
 * then ^C i ms later (0..19 ms sweeps readline's echo). Asserted: no partial
 * command ever runs; the command runs whole or not at all. Reported, not
 * asserted (slicc-kernel, not bash): a ^C that lands while readline still
 * reads is handled only when more input arrives (no EINTR), and around a
 * command's end the shell can read EOF and exit.
 */
export default async function (ctx) {
  const { pty, assert } = ctx;
  const N = 20;
  let ran = 0;
  let exited = 0;
  for (let i = 0; i < N; i++) {
    const steps = [
      { expect: '[$#] ' },
      { write: `sleep 0.1 && echo ran${i}\r` },
      ...(i ? [{ sleepMs: i }] : []),
      { write: '\x03' },
      { sleepMs: 300 },
      { write: 'echo "after"\r' },
      { sleepMs: 300 },
      { write: 'exit 0\r' },
    ];
    const t = await pty(['bash', '--norc', '-i'], { cwd: '/tmp', steps, timeoutMs: 5000 });
    assert.ok(!t.failedStep, `round ${i}: no prompt:\n${t.out}`);
    const partial = t.out.match(/\b\w*: command not found/g) ?? [];
    assert.deepEqual(partial, [], `round ${i}: a partial line ran:\n${t.out}`);
    if (/[^\w&]ran\d+\r\n/.test(t.out)) ran++;
    if (!/[^"]after\r\n/.test(t.out)) exited++;
  }
  // bth's case (5.3.0-14 cert): a ^C 1..5 ms after Enter of a short command
  // reaches bash only with the next line; that next line must still run.
  // 5.3.0-14 dropped it 40-45 times in 500 rounds.
  let lost = 0;
  const M = 20;
  for (let i = 0; i < M; i++) {
    const steps = [
      { expect: '[$#] ' },
      { write: 'true\r' },
      { sleepMs: 1 + (i % 5) },
      { write: '\x03' },
      { sleepMs: 300 },
      { write: `echo next${i}\r` },
      { sleepMs: 400 },
      { write: 'exit 0\r' },
    ];
    const t = await pty(['bash', '--norc', '-i'], { cwd: '/tmp', steps, timeoutMs: 5000 });
    assert.ok(!t.failedStep, `next-line round ${i}: no prompt:\n${t.out}`);
    if (!new RegExp(`[^\\w]next${i}\\r\\n`).test(t.out.replace(/echo next\d+/g, ''))) lost++;
  }
  assert.equal(lost, 0, `${lost} of ${M} lines typed after a late ^C did not run`);
  console.log(`sigint-line: ${N} rounds, ${ran} ran whole, ${N - ran} interrupted, 0 partial; ${exited} shells ended or dropped the next line (slicc-kernel); next line after a late ^C: ${M} of ${M} ran`);
}
