import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, pixelSha } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const tarball = resolve(process.argv[2] || join(root, '.homescoop-out/package.tgz'));
const ref = JSON.parse(readFileSync(join(here, '../fixtures/references.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'libheif-relink-'));

function sh(cmd, opts = {}) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

try {
  sh(`tar -xzf '${tarball}' -C '${work}'`);
  // homescoop#398: ldflags.txt names only files in the kit (no build-host path), every --js-library among them.
  const kit = join(work, 'package/share/libheif/relink');
  const words = readFileSync(join(kit, 'ldflags.txt'), 'utf8').trim().split(/\s+/);
  const abs = words.filter((w) => w.startsWith('/'));
  if (abs.length) throw new Error(`relink kit ldflags.txt names build-host paths: ${abs.join(' ')} (homescoop#398)`);
  const jsLibs = words.flatMap((w, i) => (words[i - 1] === '--js-library' ? [w] : []));
  if (!jsLibs.length) throw new Error('relink kit ldflags.txt names no --js-library');
  const missing = [...jsLibs, ...words.filter((w) => w.endsWith('.a'))].filter((f) => !existsSync(join(kit, f)));
  if (missing.length) throw new Error(`relink kit lacks ${missing.join(', ')}, which its ldflags.txt names (homescoop#398)`);
  sh(`eval "$(bash '${root}/scripts/install-emsdk.sh')" && bash '${work}/package/share/libheif/relink/relink.sh' '${work}/relinked'`);
  copyFileSync(join(here, '../fixtures/rainbow-451x461.heic'), join(work, 'rainbow.heic'));
  const run = (tool, args) => sh(`node '${root}/scripts/run-wasm-cli.mjs' '${work}/relinked/${tool}' -- ${args}`, { env: { ...process.env, SMOKE_WORKDIR: work } });
  const v = run('heif-info', '--version');
  if (!v.startsWith('1.23.6\n')) throw new Error(`relinked heif-info --version: ${v}`);
  run('heif-dec', '--quiet /work/rainbow.heic /work/rainbow.png');
  const got = pixelSha(decodePng(readFileSync(join(work, 'rainbow.png'))));
  if (got !== ref.png['rainbow.png'].sha256) throw new Error(`relinked heif-dec: rainbow.png ${got} != host ${ref.png['rainbow.png'].sha256}`);
  console.log(`relink-check: share/libheif/relink/relink.sh rebuilt heif-dec and heif-info from lib/*.a with ${jsLibs.join(', ')}; output equals host libheif`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
