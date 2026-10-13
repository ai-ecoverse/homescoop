import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const tarball = resolve(process.argv[2] || join(root, '.homescoop-out/package.tgz'));
const heifLib = resolve(process.argv[3] || join(root, '.homescoop-out/prefix/lib'));
const work = mkdtempSync(join(tmpdir(), 'im-heif-relink-'));

function sh(cmd) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

try {
  sh(`tar -xzf '${tarball}' -C '${work}'`);
  sh(`eval "$(bash '${root}/scripts/install-emsdk.sh')" && bash '${work}/package/share/imagemagick-heif/relink/relink.sh' '${work}/relinked' '${heifLib}'`);
  const wasm = readFileSync(join(work, 'relinked/magick.wasm'));
  if (!WebAssembly.validate(wasm)) throw new Error('relinked magick.wasm does not validate');
  const shipped = statSync(join(work, 'package/bin/magick.wasm')).size;
  if (Math.abs(wasm.length - shipped) > shipped * 0.02) throw new Error(`relinked magick.wasm is ${wasm.length} bytes, shipped ${shipped}`);
  const mod = new WebAssembly.Module(wasm);
  const names = WebAssembly.Module.exports(mod).map((e) => e.name);
  for (const n of ['main', 'slicc_raise']) {
    if (!names.includes(n) && !names.includes(`_${n}`) && !names.some((x) => x.includes(n))) throw new Error(`relinked magick.wasm lacks ${n}`);
  }
  const glue = readFileSync(join(work, 'relinked/magick'), 'utf8');
  if (!glue.includes('callMain')) throw new Error('relinked glue has no callMain');
  console.log(`relink-check: share/imagemagick-heif/relink/relink.sh relinked magick against ${heifLib}/libheif.a (${wasm.length} bytes, shipped ${shipped})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
