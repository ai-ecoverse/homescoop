// ladder-pr ci (cert/meta.json): the LGPL relink kit in share/imagemagick/relink
// links magick again (homescoop#395), with libiconv.a taken from the published
// @ai-ecoverse/wasm-libiconv of the recipe, as a user replacing it would.
// The relinked magick.wasm must validate, match the shipped one in size, imports
// and exports, and both keep their name section (homescoop#396).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKitDocs, checkKitFlags, customSections, sameSignature } from './wasm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const tarball = resolve(process.argv[2] || join(root, '.homescoop-out/package.tgz'));
const work = mkdtempSync(join(tmpdir(), 'im-relink-'));

function sh(cmd) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

try {
  const dep = sh(`node '${root}/scripts/read-recipe.mjs' imagemagick --deps`).split('\n').find((d) => d.startsWith('@ai-ecoverse/wasm-libiconv@'));
  if (!dep) throw new Error('recipe has no @ai-ecoverse/wasm-libiconv build dependency');
  sh(`mkdir -p '${work}/iconv' && cd '${work}/iconv' && npm pack '${dep}' --silent && tar -xzf *.tgz`);
  const iconv = join(work, 'iconv/package/lib');
  sh(`tar -xzf '${tarball}' -C '${work}'`);
  if (!existsSync(join(work, 'package/share/imagemagick/relink/relink.sh'))) throw new Error(`${tarball} has no share/imagemagick/relink/relink.sh (homescoop#395)`);
  const js = checkKitFlags(join(work, 'package/share/imagemagick/relink'));
  const docs = checkKitDocs(join(work, 'package'), join(work, 'package/share/imagemagick/relink'));
  // The override directory: libiconv.a from npm, plus copies of the kit's own
  // libslicc_cred.a (named in ldflags.txt) and libMagickCore (named in relink.sh):
  // relink.sh must take each of them from there.
  const kit = join(work, 'package/share/imagemagick/relink');
  const ovr = join(work, 'override');
  sh(`mkdir -p '${ovr}' && cp '${iconv}/libiconv.a' '${ovr}/' && cp '${kit}/libslicc_cred.a' '${kit}/libMagickCore-7.Q16HDRI.a' '${ovr}/'`);
  const log = sh(`eval "$(bash '${root}/scripts/install-emsdk.sh')" && bash '${kit}/relink.sh' '${work}/relinked' '${ovr}'`);
  for (const a of ['libiconv.a', 'libslicc_cred.a', 'libMagickCore-7.Q16HDRI.a']) {
    if (!log.includes(`${a} from ${ovr}`)) throw new Error(`relink.sh did not take ${a} from ${ovr}:\n${log}`);
  }
  const wasm = readFileSync(join(work, 'relinked/magick.wasm'));
  if (!WebAssembly.validate(wasm)) throw new Error('relinked magick.wasm does not validate');
  const shippedWasm = readFileSync(join(work, 'package/bin/magick.wasm'));
  const shipped = statSync(join(work, 'package/bin/magick.wasm')).size;
  if (Math.abs(wasm.length - shipped) > shipped * 0.02) throw new Error(`relinked magick.wasm is ${wasm.length} bytes, shipped ${shipped}`);
  const a = sameSignature(wasm, shippedWasm);
  for (const n of ['main', 'slicc_raise']) {
    if (!a.exports.some((x) => x.includes(n))) throw new Error(`relinked magick.wasm lacks ${n}`);
  }
  for (const [what, bytes] of [['shipped', shippedWasm], ['relinked', wasm]]) {
    if (!customSections(bytes).has('name')) throw new Error(`${what} magick.wasm has no name section (homescoop#396)`);
  }
  const glue = readFileSync(join(work, 'relinked/magick'), 'utf8');
  if (!glue.includes('callMain')) throw new Error('relinked glue has no callMain');
  console.log(
    `relink-check: share/imagemagick/relink/relink.sh relinked magick with ${dep}'s libiconv.a (${wasm.length} bytes, shipped ${shipped}; same ${a.imports.length} imports and ${a.exports.length} exports; name section in both; kit flags: ${js.join(', ')}; README.md, ${docs.cited} names all ${docs.libs} kit libraries)`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
