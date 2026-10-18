const PKG = '/node_modules/@ai-ecoverse/wasix-automake';
const SCRIPTS = ['automake', 'automake-1.17', 'aclocal', 'aclocal-1.17'];
const HOST = [/\/bin\/bash\b/, /\/home\/runner\b/, /homescoop-work/, /\.homescoop-out/, /\/Users\//, /\/opt\/homebrew\b/];

export default async function (ctx) {
  const { read, assert } = ctx;
  for (const name of SCRIPTS) {
    const text = await read(`${PKG}/bin/${name}`);
    assert.ok(text, `bin/${name} ships`);
    if (/\$ENV\{'SHELL'\}/.test(text)) {
      assert.match(text, /\$ENV\{'SHELL'\} = '\/bin\/sh' if exists \$ENV\{'DJDIR'\};/, `bin/${name} names /bin/sh, not the build host's shell`);
    }
    for (const re of HOST) assert.doesNotMatch(text, re, `bin/${name} carries a build-host path (${re})`);
  }
  console.log(`wasix-automake: ${SCRIPTS.join(', ')} name /bin/sh and carry no build-host path`);
}
