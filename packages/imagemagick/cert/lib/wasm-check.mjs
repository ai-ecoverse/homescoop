// ladder-pr ci (cert/meta.json, homescoop#593, #396): the runtime package's
// bin/magick.wasm has a name section and no DWARF; the package ships no relink
// kit (no share/), its README's Relinking section points to
// @ai-ecoverse/wasm-imagemagick-relink, and package.json (homescoop.relink) and
// THIRD-PARTY-NOTICES.md name it, the notices at exactly this version (#678).
//   node packages/imagemagick/cert/lib/wasm-check.mjs [package.tgz]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customSections } from './wasm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const tarball = resolve(process.argv[2] || join(root, '.homescoop-out/package.tgz'));
const work = mkdtempSync(join(tmpdir(), 'im-wasm-check-'));
const KIT = '@ai-ecoverse/wasm-imagemagick-relink';

try {
  const r = spawnSync('tar', ['-xzf', tarball, '-C', work], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar -xzf ${tarball}: ${r.stderr}`);
  const pkg = join(work, 'package');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const { name, version } = manifest;
  // homescoop#678: the runtime names its relink kit package, of exactly this version.
  if (manifest.homescoop?.relink !== KIT) throw new Error(`${name}: package.json homescoop.relink is ${manifest.homescoop?.relink ?? '(none)'}, not ${KIT}`);
  const wasm = readFileSync(join(pkg, 'bin/magick.wasm'));
  const sec = [...customSections(wasm).entries()];
  if (!sec.some(([n]) => n === 'name')) throw new Error(`${name}: bin/magick.wasm has no name section (homescoop#396)`);
  const dwarf = sec.filter(([n]) => n.startsWith('.debug'));
  if (dwarf.length) throw new Error(`${name}: bin/magick.wasm has DWARF, ${dwarf.map(([n, s]) => `${n} ${s}`).join(', ')} (homescoop#593: name section only)`);
  if (existsSync(join(pkg, 'share'))) throw new Error(`${name}: ships share/ (the relink kit belongs in ${KIT}, homescoop#593)`);
  const readme = readFileSync(join(pkg, 'README.md'), 'utf8');
  const at = readme.search(/^## Relinking/m);
  if (at < 0 || !readme.slice(at).split(/^## (?!Relinking)/m)[0].includes(KIT)) throw new Error(`${name}: README.md's Relinking section does not point to ${KIT}`);
  if (!readFileSync(join(pkg, 'THIRD-PARTY-NOTICES.md'), 'utf8').includes(`${KIT}@${version}`)) throw new Error(`${name}: THIRD-PARTY-NOTICES.md does not name ${KIT}@${version}`);
  const needles = [...new Set([root, '.homescoop-out', '/home/runner/work', process.env.EMSDK, process.env.HOME && join(process.env.HOME, '.cache/emsdk')].filter((n) => n && n.length > 4))];
  const leaks = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const buf = readFileSync(p);
        for (const n of needles) if (buf.includes(n)) leaks.push(`${p.slice(work.length + 1)}: ${n}`);
      }
    }
  };
  walk(pkg);
  if (leaks.length) throw new Error(`${name}: build paths in the tarball (homescoop#937):\n  ${leaks.join('\n  ')}`);
  const cfg = readFileSync(join(pkg, 'etc/ImageMagick-7/configure.xml'), 'utf8');
  if (!/<configure name="LIBS" value="[^"]*-L\/prefix\/lib/.test(cfg)) throw new Error(`${name}: etc/ImageMagick-7/configure.xml LIBS doesn't name /prefix/lib (homescoop#937)`);
  const names = sec.find(([n]) => n === 'name')[1];
  console.log(`wasm-check: ${name} bin/magick.wasm ${wasm.length} bytes, name section ${names} bytes, no DWARF; no share/; package.json and notices name ${KIT}@${version}; no build path (${needles.length} checked) in any file, configure.xml says /prefix`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
