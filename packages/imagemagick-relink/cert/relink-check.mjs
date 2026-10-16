// ladder-pr ci (cert/meta.json, homescoop#593, #395, #594): both kits of the
// package relink magick. The override directory holds libiconv.a from the
// recipe's published @ai-ecoverse/wasm-libiconv and copies of the kit's
// libslicc_cred.a and libMagickCore (the heif kit also wasm-libheif's three
// libraries), and relink.sh must take each from there. The relinked
// magick.wasm validates, has the imports and exports that kit.json records for
// the binary the kit's objects made, about its size, a name section and no
// DWARF. Versions: this package, both runtime recipes and both kit.json agree.
//
//   node packages/imagemagick-relink/cert/relink-check.mjs [relink.tgz] [--runtime <runtime.tgz> ...]
// --runtime (cert-review, by hand): a runtime tarball of the same version
// whose bin/magick.wasm must be the binary kit.json names (same sha256).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKitDocs, checkKitFlags, customSections, signature } from '../../imagemagick/cert/lib/wasm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const runtimes = [];
let tarball = join(root, '.homescoop-out/package.tgz');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--runtime') runtimes.push(resolve(args[++i]));
  else tarball = resolve(args[i]);
}
const work = mkdtempSync(join(tmpdir(), 'im-relink-kits-'));
const KITS = { imagemagick: '@ai-ecoverse/wasm-imagemagick', 'imagemagick-heif': '@ai-ecoverse/wasm-imagemagick-heif' };

function sh(cmd) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const hash = (l) => createHash('sha256').update(l.join('\n')).digest('hex');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const dep = (name) => {
  const d = sh(`node '${root}/scripts/read-recipe.mjs' imagemagick-relink --deps`).split('\n').find((x) => x.startsWith(`${name}@`));
  if (!d) throw new Error(`recipe has no ${name} build dependency`);
  return d;
};
const fetch = (spec, dir) => {
  sh(`mkdir -p '${work}/${dir}' && cd '${work}/${dir}' && npm pack '${spec}' --silent && tar -xzf *.tgz`);
  return join(work, dir, 'package');
};

try {
  sh(`tar -xzf '${tarball}' -C '${work}'`);
  const pkg = join(work, 'package');
  const version = json(join(pkg, 'package.json')).version;
  for (const r of Object.keys(KITS)) {
    const v = json(join(root, 'packages', r, 'package/package.json')).version;
    if (v !== version) throw new Error(`packages/${r} is ${v}, this package ${version}: bump them together`);
  }
  const iconv = join(fetch(dep('@ai-ecoverse/wasm-libiconv'), 'iconv'), 'lib/libiconv.a');
  const heif = join(fetch(dep('@ai-ecoverse/wasm-libheif'), 'libheif'), 'lib');
  const emsdk = `eval "$(bash '${root}/scripts/install-emsdk.sh')"`;
  const out = [];
  for (const [r, npm] of Object.entries(KITS)) {
    const kit = join(pkg, 'share', r, 'relink');
    if (!existsSync(join(kit, 'relink.sh'))) throw new Error(`no share/${r}/relink/relink.sh`);
    const meta = json(join(kit, 'kit.json'));
    if (meta.package !== npm || meta.version !== version) throw new Error(`share/${r}/relink/kit.json is ${meta.package}@${meta.version}, expected ${npm}@${version}`);
    const js = checkKitFlags(kit);
    const docs = checkKitDocs(pkg, kit);
    const ovr = join(work, `override-${r}`);
    const extra = r === 'imagemagick-heif' ? ['libheif.a', 'libde265.a', 'libdav1d.a'].map((a) => `'${join(heif, a)}'`).join(' ') : '';
    sh(`mkdir -p '${ovr}' && cp '${iconv}' '${kit}/libslicc_cred.a' '${kit}/libMagickCore-7.Q16HDRI.a' ${extra} '${ovr}/'`);
    const log = sh(`${emsdk} && bash '${kit}/relink.sh' '${work}/relinked-${r}' '${ovr}' 2>&1`);
    for (const a of ['libiconv.a', 'libslicc_cred.a', 'libMagickCore-7.Q16HDRI.a']) {
      if (!log.includes(`${a} from ${ovr}`)) throw new Error(`share/${r}/relink/relink.sh did not take ${a} from ${ovr}:\n${log}`);
    }
    const wasm = readFileSync(join(work, `relinked-${r}`, 'magick.wasm'));
    if (!WebAssembly.validate(wasm)) throw new Error(`${r}: relinked magick.wasm does not validate`);
    if (Math.abs(wasm.length - meta.size) > meta.size * 0.02) throw new Error(`${r}: relinked magick.wasm is ${wasm.length} bytes, the kit's build ${meta.size}`);
    const sig = signature(wasm);
    if (hash(sig.imports) !== meta.imports) throw new Error(`${r}: relinked magick.wasm imports differ from kit.json`);
    if (hash(sig.exports) !== meta.exports) throw new Error(`${r}: relinked magick.wasm exports differ from kit.json`);
    const sec = [...customSections(wasm).keys()];
    if (!sec.includes('name')) throw new Error(`${r}: relinked magick.wasm has no name section`);
    if (sec.some((s) => s.startsWith('.debug'))) throw new Error(`${r}: relinked magick.wasm has DWARF (${sec.join(' ')}; homescoop#593)`);
    const glue = readFileSync(join(work, `relinked-${r}`, 'magick'), 'utf8');
    if (!glue.includes('callMain')) throw new Error(`${r}: relinked glue has no callMain`);
    out.push(`${r}: ${wasm.length} bytes (kit.json ${meta.size}), same ${sig.imports.length} imports and ${sig.exports.length} exports, name section, no DWARF, ${js.length} js libraries, README names ${docs.libs} libraries`);
  }
  for (const t of runtimes) {
    const d = join(work, `runtime-${out.length}`);
    sh(`mkdir -p '${d}' && tar -xzf '${t}' -C '${d}'`);
    const m = json(join(d, 'package/package.json'));
    const r = Object.keys(KITS).find((k) => KITS[k] === m.name);
    if (!r) throw new Error(`${t} is ${m.name}, not a runtime package of these kits`);
    const meta = json(join(pkg, 'share', r, 'relink/kit.json'));
    const got = sha256(readFileSync(join(d, 'package/bin/magick.wasm')));
    if (m.version !== meta.version || got !== meta.sha256) throw new Error(`${m.name}@${m.version} bin/magick.wasm ${got} is not kit.json's ${meta.version} ${meta.sha256}`);
    out.push(`${m.name}@${m.version}: bin/magick.wasm is the kit's build (sha256 ${got})`);
  }
  console.log(`relink-check (wasm-imagemagick-relink ${version}): ${out.join('; ')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
