import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = join(dirname(fileURLToPath(import.meta.url)), '..');

export default async function docs(ctx) {
  const { assert } = ctx;
  const shipped = await ctx.read('/node_modules/@ai-ecoverse/wasm-screen/README.md');
  const pkg = JSON.parse(await ctx.read('/node_modules/@ai-ecoverse/wasm-screen/package.json'));
  assert.match(shipped, new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')} `, 'm'), `the shipped README has a ## ${pkg.version} section (homescoop#1600)`);
  assert.ok(!existsSync(join(recipe, 'README.md')), 'packages/screen/README.md exists; the package README is package/README.md only (homescoop#1600)');
  assert.doesNotMatch(readFileSync(join(recipe, 'build.sh'), 'utf8'), /^\s*cp\s.*README\.md/m, 'build.sh copies a README over package/README.md (homescoop#1600)');
  const committed = JSON.parse(readFileSync(join(recipe, 'package/package.json'), 'utf8'));
  if (committed.version === pkg.version) {
    assert.equal(shipped, readFileSync(join(recipe, 'package/README.md'), 'utf8'), 'the shipped README is the committed package/README.md (homescoop#1600)');
  }
  console.log(`docs: the shipped README is package/README.md with a ## ${pkg.version} section; no recipe-root README`);
}
