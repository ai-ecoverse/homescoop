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
  console.log(`sigint-line: ${N} rounds, ${ran} ran whole, ${N - ran} interrupted, 0 partial; ${exited} shells ended or dropped the next line (slicc-kernel)`);
}
