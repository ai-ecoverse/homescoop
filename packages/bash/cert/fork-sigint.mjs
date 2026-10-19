export default async function (ctx) {
  const { pty, assert } = ctx;
  const bad = [];
  for (const job of ['sleep 5', 'sleep 5 | cat']) {
    for (const ms of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 60, 80, 120, 200, 300]) {
      const r = await pty(['bash', '--norc', '-i'], {
        steps: [
          { expect: '[$#] ' },
          { write: `${job}\r` },
          { sleepMs: ms, write: '\x03' },
          { expect: '[$#] ', timeoutMs: 8000 },
          { write: 'echo "after=$((6*7))"\r' },
          { expect: 'after=42', timeoutMs: 8000 },
          { expect: '[$#] ', timeoutMs: 8000 },
          { write: 'exit 0\r' },
        ],
        timeoutMs: 15000,
      });
      if (r.failedStep || r.status !== 0) bad.push(`${ms} ms into "${job}": exit ${r.status}, ${r.failedStep ? `no ${JSON.stringify(r.failedStep.expect)}` : 'no prompt left'}; ${JSON.stringify(r.out.slice(-160))}`);
    }
  }
  assert.deepEqual(bad, [], `a ^C while bash forks a job must leave bash at its prompt, reading the next line:\n${bad.join('\n')}`);
  console.log('wasm-bash: a ^C 0..300 ms into the first forked job of a fresh interactive bash (sleep 5, sleep 5 | cat) leaves bash at its prompt reading the next line, exit 0');
}
