/** xz checklist: compress/decompress round trip + corrupt input. */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;

  await write('home/plain.txt', 'homescoop-xz-cert\n');
  const z = await run(['xz', '-c', '/home/plain.txt'], { cwd: '/home' });
  assert.equal(z.status, 0, `xz -c stderr=${z.stderr}`);
  // kernel.run returns stdout as UTF-8 text; binary may be mangled.
  // Prefer file-based round trip:
  const zf = await run(['xz', '-k', '/home/plain.txt'], { cwd: '/home' });
  assert.equal(zf.status, 0, `xz -k stderr=${zf.stderr}`);
  const d = await run(['xz', '-dk', '-c', '/home/plain.txt.xz'], { cwd: '/home' });
  assert.equal(d.status, 0, `xz -d stderr=${d.stderr}`);
  assert.equal(d.stdout, 'homescoop-xz-cert\n');

  await write('home/bad.xz', 'not-an-xz-stream');
  const bad = await run(['xz', '-dc', '/home/bad.xz'], { cwd: '/home' });
  assert.notEqual(bad.status, 0, 'corrupt xz must fail');
}
