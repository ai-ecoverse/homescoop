const PKG = '/node_modules/@ai-ecoverse/wasm-tar';

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const m = await run(['bash', '-c', `stat -c "%a %n" ${PKG}/bin/tar ${PKG}/bin/tar.wasm`], { cwd: '/tmp' });
  assert.equal(m.status, 0, `${m.stdout}${m.stderr}`);
  assert.deepEqual(m.stdout.trim().split('\n'), [`755 ${PKG}/bin/tar`, `755 ${PKG}/bin/tar.wasm`], `installed with the tarball's modes: ${m.stdout}`);
  await addUser({ name: 'cone' });
  const v = await run(['bash', '-c', `${PKG}/bin/tar --version | head -1; echo "rc=\${PIPESTATUS[0]}"`], { cwd: '/tmp', user: 'cone' });
  assert.equal(v.status, 0, `${v.stdout}${v.stderr}`);
  assert.deepEqual(v.stdout.trim().split('\n'), ['tar (GNU tar) 1.35', 'rc=0'], `bin/tar by path as cone under users enforce: ${v.stdout}${v.stderr}`);
  console.log('glue-mode: bin/tar and bin/tar.wasm installed 755; as cone (users enforce) bin/tar by path runs');
}
