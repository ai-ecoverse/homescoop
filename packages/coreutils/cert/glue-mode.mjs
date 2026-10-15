const PKG = '/node_modules/@ai-ecoverse/wasm-coreutils';

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const m = await run(['bash', '-c', `stat -c "%a %n" ${PKG}/bin/coreutils ${PKG}/bin/coreutils.wasm`], { cwd: '/tmp' });
  assert.equal(m.status, 0, `${m.stdout}${m.stderr}`);
  assert.deepEqual(m.stdout.trim().split('\n'), [`755 ${PKG}/bin/coreutils`, `755 ${PKG}/bin/coreutils.wasm`], `installed with the tarball's modes: ${m.stdout}`);
  await addUser({ name: 'cone' });
  const v = await run(['bash', '-c', `${PKG}/bin/coreutils --coreutils-prog=true; echo "rc=$?"; ${PKG}/bin/coreutils --version | head -1`], { cwd: '/tmp', user: 'cone' });
  assert.equal(v.status, 0, `${v.stdout}${v.stderr}`);
  assert.deepEqual(v.stdout.trim().split('\n'), ['rc=0', 'coreutils (GNU coreutils) 9.12'], `bin/coreutils by path as cone under users enforce: ${v.stdout}${v.stderr}`);
  console.log('glue-mode: bin/coreutils and bin/coreutils.wasm installed 755; as cone (users enforce) bin/coreutils by path runs');
}
