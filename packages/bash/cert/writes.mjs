/**
 * wasm-bash 5.3.0-11: one write() per flushed stdout buffer, as on a real
 * system and as wasm-bash 5.3.0-7 did. Since 5.3.0-8 (emscripten 4.0.23)
 * musl's two-iovec writev of a line-buffered stdout reached the kernel as
 * two writes ("one", then "\n"), visible to embedders streaming output and
 * to pipe readers. shims/slicc/slicc-writev.js gathers the iovecs again.
 * ctx.runWrites gives stdout one entry per chunk the kernel delivered.
 */
export default async function (ctx) {
  const { runWrites, assert } = ctx;
  const cases = [
    ['echo one', ['one\n']],
    ["printf 'a\\nb\\n'", ['a\n', 'b\n']],
    ['echo one; echo two', ['one\n', 'two\n']],
    ['for i in 1 2 3; do echo $i; done', ['1\n', '2\n', '3\n']],
    ['echo -n x; echo y', ['x', 'y\n']],
    ['printf %s abc', ['abc']],
  ];
  for (const [script, want] of cases) {
    const r = await runWrites(['bash', '-c', script]);
    assert.equal(r.status, 0, `${script}: ${r.stderr}`);
    assert.deepEqual(r.writes, want, `bash -c ${JSON.stringify(script)}: writes ${JSON.stringify(r.writes)}`);
  }
  // A loop to a pipe: the reader sees whole lines, never a lone "\n".
  const loop = await runWrites(['bash', '-c', 'for i in $(seq 1 20); do echo line$i; done']);
  assert.equal(loop.status, 0, loop.stderr);
  assert.equal(loop.writes.join(''), Array.from({ length: 20 }, (_, i) => `line${i + 1}\n`).join(''));
  assert.ok(!loop.writes.includes('\n'), `a write of a lone newline: ${JSON.stringify(loop.writes)}`);
  assert.equal(loop.writes.length, 20, `20 echos, ${loop.writes.length} writes: ${JSON.stringify(loop.writes)}`);
}
