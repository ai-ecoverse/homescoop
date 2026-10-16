import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKitFlags, customSections, sameSignature } from '../../../imagemagick/cert/lib/wasm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const tarball = resolve(process.argv[2] || join(root, '.homescoop-out/package.tgz'));
const work = mkdtempSync(join(tmpdir(), 'im-heif-relink-'));
let heifLib = resolve(process.argv[3] || join(root, '.homescoop-out/prefix/lib'));

function sh(cmd) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

try {
  if (!existsSync(join(heifLib, 'libheif.a'))) {
    const dep = sh(`node '${root}/scripts/read-recipe.mjs' imagemagick-heif --deps`).split('\n').find((d) => d.startsWith('@ai-ecoverse/wasm-libheif@'));
    if (!dep) throw new Error('recipe has no @ai-ecoverse/wasm-libheif build dependency');
    sh(`mkdir -p '${work}/libheif' && cd '${work}/libheif' && npm pack '${dep}' --silent && tar -xzf *.tgz`);
    heifLib = join(work, 'libheif/package/lib');
  }
  sh(`tar -xzf '${tarball}' -C '${work}'`);
  const js = checkKitFlags(join(work, 'package/share/imagemagick-heif/relink'));
  sh(`eval "$(bash '${root}/scripts/install-emsdk.sh')" && bash '${work}/package/share/imagemagick-heif/relink/relink.sh' '${work}/relinked' '${heifLib}'`);
  const wasm = readFileSync(join(work, 'relinked/magick.wasm'));
  if (!WebAssembly.validate(wasm)) throw new Error('relinked magick.wasm does not validate');
  const shippedWasm = readFileSync(join(work, 'package/bin/magick.wasm'));
  const shipped = statSync(join(work, 'package/bin/magick.wasm')).size;
  if (Math.abs(wasm.length - shipped) > shipped * 0.02) throw new Error(`relinked magick.wasm is ${wasm.length} bytes, shipped ${shipped}`);
  const names = sameSignature(wasm, shippedWasm).exports;
  for (const n of ['main', 'slicc_raise']) {
    if (!names.some((x) => x.includes(n))) throw new Error(`relinked magick.wasm lacks ${n}`);
  }
  // homescoop#396: like wasm-imagemagick, magick.wasm keeps its name section (trap stacks show function names).
  for (const [what, bytes] of [['shipped', shippedWasm], ['relinked', wasm]]) {
    if (!customSections(bytes).has('name')) throw new Error(`${what} magick.wasm has no name section (homescoop#396)`);
  }
  const glue = readFileSync(join(work, 'relinked/magick'), 'utf8');
  if (!glue.includes('callMain')) throw new Error('relinked glue has no callMain');
  console.log(`relink-check: share/imagemagick-heif/relink/relink.sh relinked magick against ${heifLib}/libheif.a (${wasm.length} bytes, shipped ${shipped}; same imports and exports; name section in both; kit flags: ${js.join(', ')})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
