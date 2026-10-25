export default async function ({ run, write, assert, page, kernel }) {
  const base = '/tmp/fs-notice';
  const cases = [
    { path: `${base}/new/deeper/x.txt`, data: 'hi\n', want: 'aGkK' },
    { path: `${base}/bytes.bin`, data: Uint8Array.of(0, 0xff, 0x80, 0x0a), want: 'AP+ACg==' },
    { path: `${base}/new/deeper/y.txt`, data: 'again\n', want: 'YWdhaW4K' },
  ];
  const made = await run(['mkdir', '-p', base], { cwd: '/tmp' });
  assert.equal(made.status, 0, made.stderr);
  for (const { path, data, want } of cases) {
    const before = await run(['cat', path], { cwd: '/tmp' });
    assert.notEqual(before.status, 0, `${path} is missing before ctx.write`);
    assert.match(before.stderr, /No such file or directory/, before.stderr);
    await write(path, data);
    const after = await run(['cat', path], { cwd: '/tmp' });
    assert.equal(after.status, 0, `the kernel sees ${path} at once after ctx.write: ${after.stderr}`);
    const bytes = await run(['base64', '-w0', path], { cwd: '/tmp' });
    assert.equal(bytes.stdout, want, `${path} has the bytes ctx.write wrote`);
  }
  const listed = await run(['ls', `${base}/new/deeper`], { cwd: '/tmp' });
  assert.equal(listed.stdout, 'x.txt\ny.txt\n');
  const notices = await page.evaluate(() =>
    import('/dist/meta.js').then(
      (meta) => typeof meta.postFsNotice === 'function',
      () => false,
    ),
  );
  const how = await page.evaluate(() => window.certFsNotice);
  assert.equal(
    how,
    notices ? 'posted' : 'waited',
    `ctx.write on ${kernel?.name}@${kernel?.version} ${notices ? 'posts an fs notice' : 'has no postFsNotice, so it waits out the 100 ms'}`,
  );
}
