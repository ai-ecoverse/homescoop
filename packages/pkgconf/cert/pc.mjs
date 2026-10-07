/** pkgconf checklist: version, modversion from .pc, missing package. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const ver = await run(['pkgconf', '--version']);
  assert.equal(ver.status, 0, ver.stderr);
  assert.match(ver.stdout.trim(), /^\d+\.\d+/);

  await write(
    'home/lib/pkgconfig/homescoop-cert.pc',
    [
      'prefix=/home',
      'Name: homescoop-cert',
      'Description: cert stub',
      'Version: 9.9.9',
      'Libs:',
      'Cflags:',
      '',
    ].join('\n'),
  );

  const mod = await run(['pkgconf', '--modversion', 'homescoop-cert'], {
    cwd: '/home',
    env: { PKG_CONFIG_PATH: '/home/lib/pkgconfig' },
  });
  assert.equal(mod.status, 0, mod.stderr);
  assert.equal(mod.stdout.trim(), '9.9.9');

  const miss = await run(['pkgconf', '--modversion', 'no-such-pkg-xyz'], {
    env: { PKG_CONFIG_PATH: '/home/lib/pkgconfig' },
  });
  assert.notEqual(miss.status, 0);
}
