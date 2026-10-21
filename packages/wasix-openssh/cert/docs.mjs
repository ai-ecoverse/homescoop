import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = join(dirname(fileURLToPath(import.meta.url)), '..');

export default async function docs(ctx) {
  const { assert, pkgDir } = ctx;
  const shipped = readFileSync(join(pkgDir, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const sysroot = /@ai-ecoverse\/wasix-sysroot@(\S+)$/.exec(pkg.homescoop?.sysroot ?? '')?.[1];
  assert.ok(sysroot, `package.json homescoop.sysroot: ${pkg.homescoop?.sysroot}`);
  const built = /Built with the pinned wasixcc on \*\*wasix-sysroot (\S+)\*\*/.exec(shipped)?.[1];
  assert.equal(built, sysroot, `the shipped README's "Built with" line names wasix-sysroot ${built}, the package is built on ${sysroot} (homescoop#1446)`);
  const sysrootSection = /^## Sysroot\s+\*\*wasix-sysroot (\S+)\*\*/m.exec(shipped)?.[1];
  assert.equal(sysrootSection, sysroot, `the shipped README's Sysroot section names wasix-sysroot ${sysrootSection}, not ${sysroot}`);
  assert.match(shipped, new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}$`, 'm'), `the shipped README has a ## ${pkg.version} section (homescoop#1446)`);
  assert.doesNotMatch(shipped, /exported `HOSTNAME`/, 'the key comment host is the kernel\'s node name, not the exported HOSTNAME (homescoop#1426)');
  const committed = JSON.parse(readFileSync(join(recipe, 'package/package.json'), 'utf8'));
  if (committed.version === pkg.version) {
    assert.equal(shipped, readFileSync(join(recipe, 'package/README.md'), 'utf8'), 'the shipped README is the committed package/README.md (homescoop#1446)');
  }
  const notes = readFileSync(join(recipe, 'recipe.yaml'), 'utf8');
  for (const m of notes.matchAll(/wasix-sysroot (2025\.\d+\.\d+-\d+)/g)) {
    if (committed.version === pkg.version) assert.equal(m[1], sysroot, `recipe.yaml names wasix-sysroot ${m[1]}, the package is built on ${sysroot} (homescoop#1426)`);
  }
  console.log(`docs: the shipped README names wasix-sysroot ${sysroot} twice and has a ## ${pkg.version} section`);
}
