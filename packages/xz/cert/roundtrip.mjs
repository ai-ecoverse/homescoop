/** xz checklist: round trip + threaded flags that exercise mythread_sigmask. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  // Small round trip (argv0 / basic encode path).
  await write('home/plain.txt', 'homescoop-xz-cert\n');
  const zf = await run(['xz', '-k', '-f', '/home/plain.txt'], { cwd: '/home' });
  assert.equal(zf.status, 0, `xz -k stderr=${zf.stderr}`);
  const d = await run(['xz', '-dk', '-c', '-f', '/home/plain.txt.xz'], { cwd: '/home' });
  assert.equal(d.status, 0, `xz -d stderr=${d.stderr}`);
  assert.equal(d.stdout, 'homescoop-xz-cert\n');

  await write('home/bad.xz', 'not-an-xz-stream');
  const bad = await run(['xz', '-dc', '/home/bad.xz'], { cwd: '/home' });
  assert.notEqual(bad.status, 0, 'corrupt xz must fail');

  // Patch exercise: wasm-mythread-sigmask.patch enables mythread_sigmask on
  // wasm. -T0/-T2 over a multi-block payload (> one xz block) goes through
  // that path even when the recipe uses --disable-threads (-T may fall back
  // to the single-thread encoder that still uses mythread_sigmask).
  const line = 'homescoop-xz-cert-line\n';
  const big = line.repeat(Math.ceil((4 * 1024 * 1024) / line.length)).slice(0, 4 * 1024 * 1024);
  assert.equal(big.length, 4 * 1024 * 1024);
  await write('home/big.txt', big);

  for (const threads of ['0', '2']) {
    const cz = await run(['xz', `-T${threads}`, '-k', '-f', '/home/big.txt'], { cwd: '/home' });
    assert.equal(cz.status, 0, `xz -T${threads} compress stderr=${cz.stderr}`);
    const cd = await run(['xz', `-T${threads}`, '-dk', '-c', '-f', '/home/big.txt.xz'], {
      cwd: '/home',
    });
    assert.equal(cd.status, 0, `xz -T${threads} decompress stderr=${cd.stderr}`);
    assert.equal(cd.stdout.length, big.length, `xz -T${threads} length`);
    assert.equal(cd.stdout, big, `xz -T${threads} bytes`);
  }
}
