import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' } } });
const root = new URL('../../../', import.meta.url).pathname;
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasi-zig-libc-src', '--json'], { encoding: 'utf8' }));
const url = recipe.source.url.replaceAll('{{version}}', recipe.version);
const work = mkdtempSync(join(root, '.homescoop-out', 'zls-identity-'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = (dir, base = dir, out = new Map()) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.set(relative(base, p), sha(p));
  }
  return out;
};
try {
  const txz = join(work, 'zig.tar.xz');
  execFileSync('curl', ['-fsSL', '--retry', '3', url, '-o', txz]);
  const got = sha(txz);
  if (got !== recipe.source.sha256) throw new Error(`${url}: sha256 ${got}, recipe pins ${recipe.source.sha256}`);
  execFileSync('tar', ['-xJf', txz, '-C', work, '--strip-components=1', `zig-${recipe.version}/lib/libc/wasi`, `zig-${recipe.version}/lib/libc/musl`, `zig-${recipe.version}/LICENSE`]);
  execFileSync('mkdir', ['-p', join(work, 'pkg')]);
  execFileSync('tar', ['-xzf', values.tarball, '-C', join(work, 'pkg')]);
  const want = walk(join(work, 'lib', 'libc'));
  const have = walk(join(work, 'pkg', 'package', 'lib', 'libc'));
  const missing = [...want.keys()].filter((k) => !have.has(k));
  const extra = [...have.keys()].filter((k) => !want.has(k));
  const differ = [...want.keys()].filter((k) => have.has(k) && have.get(k) !== want.get(k));
  const licence = sha(join(work, 'LICENSE')) === sha(join(work, 'pkg', 'package', 'LICENSE'));
  console.log(`lib/libc: ${want.size} files in zig-${recipe.version}.tar.xz, ${have.size} in the package; missing ${missing.length}, extra ${extra.length}, differing ${differ.length}; LICENSE ${licence ? 'same' : 'differs'}`);
  if (missing.length || extra.length || differ.length || !licence) {
    console.error(JSON.stringify({ missing: missing.slice(0, 10), extra: extra.slice(0, 10), differ: differ.slice(0, 10) }));
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
