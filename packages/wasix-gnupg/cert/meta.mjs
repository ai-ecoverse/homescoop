import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'package');

export default async function (ctx) {
  const { assert } = ctx;
  const dir = `/node_modules/${ctx.npmName}`;
  const want = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const got = JSON.parse((await ctx.read(`${dir}/package.json`)) ?? '{}');
  assert.equal(got.version, want.version, 'the tarball is the committed version');
  assert.equal(got.description, want.description, `the tarball's description is packages/wasix-gnupg/package/package.json's (homescoop#1448; 2.4.9-12: build.sh's own text)`);
  assert.deepEqual(got.engines, want.engines, 'engines as committed');
  assert.deepEqual(got.slicc, want.slicc, `the tarball's slicc.commands are package/package.json's (homescoop#1448)`);
  assert.equal(got.slicc?.commands?.['gpg-agent']?.helper, true, `gpg-agent is a helper command (homescoop#1448; 2.4.9-12: no helper)`);
  const readme = (await ctx.read(`${dir}/README.md`)) ?? '';
  assert.equal(readme, readFileSync(join(pkgDir, 'README.md'), 'utf8'), `the tarball's README.md is packages/wasix-gnupg/package/README.md (homescoop#1448; 2.4.9-12: the recipe README, no 2.4.9-12 section)`);
  assert.match(readme, new RegExp(`^## ${want.version.replace(/\./g, '\\.')}$`, 'm'), `README.md has a section for ${want.version}`);
  for (const c of [...new Set(Object.values(want.slicc.commands).map((x) => x.wasm))]) {
    const bytes = await ctx.readBytes(`${dir}/${c}`);
    assert.ok(bytes && bytes.length, `${c} is in the tarball`);
    for (const s of ['.work/', '/home/runner/', '/Users/']) {
      assert.equal(bytes.indexOf(s), -1, `${c} embeds no build path (${s}) (homescoop#1601; 2.4.9-12: /home/runner/work/homescoop/homescoop/packages/wasix-gnupg/.work/prefix/etc)`);
    }
  }
  console.log(`meta: the tarball's package.json description, engines and slicc.commands (gpg-agent a helper) and its README.md are the committed package/ files, with a ${want.version} section (#1448); no bin/*.wasm embeds a build path (#1601)`);
}
