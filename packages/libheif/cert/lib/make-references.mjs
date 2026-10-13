import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFO_CASES, PNG_CASES, TOLERANCE } from './cases.mjs';
import { FIXTURES, fixture } from './fixtures.mjs';
import { decodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const pkgBin = resolve(process.argv[2] || join(root, 'packages/libheif/package/bin'));
const hostConvert = process.env.HOST_HEIF_CONVERT || 'heif-convert';
const hostInfo = process.env.HOST_HEIF_INFO || 'heif-info';

const ver = spawnSync(hostConvert, ['--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
if (ver !== '1.23.6') throw new Error(`host heif-convert is ${ver}, want 1.23.6`);

const work = mkdtempSync(join(tmpdir(), 'libheif-ref-'));
const hostDir = join(work, 'host');
const wasmDir = join(work, 'wasm');
spawnSync('mkdir', ['-p', hostDir, wasmDir]);
for (const name of Object.keys(FIXTURES)) {
  const b = await fixture(name);
  writeFileSync(join(hostDir, name), b);
  writeFileSync(join(wasmDir, name), b);
}

function wasm(tool, args) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/run-wasm-cli.mjs'), join(pkgBin, tool), '--', ...args], {
    cwd: wasmDir,
    env: { ...process.env, SMOKE_WORKDIR: wasmDir },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`wasm ${tool} ${args.join(' ')}: ${r.status} ${r.stderr}`);
  return r;
}

const out = { host: `libheif ${ver} (${hostConvert})`, tolerance: TOLERANCE, png: {}, info: {} };
for (const c of PNG_CASES) {
  const h = spawnSync(hostConvert, ['--quiet', ...c.args], { cwd: hostDir, encoding: 'utf8' });
  if (h.status !== 0) throw new Error(`host ${c.id}: ${h.stderr}`);
  wasm('heif-dec', ['--quiet', ...c.args.map((a) => (a.startsWith('-') ? a : `/work/${a}`))]);
  for (const o of c.outputs) {
    const a = decodePng(readFileSync(join(hostDir, o)));
    const b = decodePng(readFileSync(join(wasmDir, o)));
    if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels || a.depth !== b.depth) {
      throw new Error(`${o}: shape differs`);
    }
    const fixes = [];
    let worst = 0;
    for (let i = 0; i < a.samples.length; i++) {
      if (a.samples[i] !== b.samples[i]) {
        const d = Math.abs(a.samples[i] - b.samples[i]);
        if (d > worst) worst = d;
        if (d > TOLERANCE.maxDelta[a.depth]) throw new Error(`${o}: sample ${i} differs by ${d}`);
        fixes.push([i, a.samples[i]]);
      }
    }
    if (fixes.length > TOLERANCE.maxFixedFraction * a.samples.length) throw new Error(`${o}: ${fixes.length} samples differ`);
    out.png[o] = {
      width: a.width,
      height: a.height,
      colorType: a.colorType,
      depth: a.depth,
      sha256: createHash('sha256').update(a.pixels).digest('hex'),
      fixes,
    };
    console.log(`${o}: ${a.width}x${a.height}x${a.channels}@${a.depth} host-vs-wasm differing samples ${fixes.length}, max delta ${worst}`);
  }
}
for (const f of INFO_CASES) {
  const h = spawnSync(hostInfo, [f], { cwd: hostDir, encoding: 'utf8' });
  if (h.status !== 0) throw new Error(`host heif-info ${f}: ${h.stderr}`);
  out.info[f] = h.stdout;
}
writeFileSync(join(here, '..', 'fixtures', 'references.json'), `${JSON.stringify(out, null, 1)}\n`);
rmSync(work, { recursive: true, force: true });
console.log('wrote fixtures/references.json');
