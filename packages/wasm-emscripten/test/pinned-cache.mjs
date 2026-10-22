#!/usr/bin/env node
// homescoop#1028: the emscripten-cache that a wasm-emscripten tarball pins
// must be built from the same 6.0.9 tree as the package's headers. Reads the
// exact @ai-ecoverse/emscripten-cache pin from the tarball's package.json and
// runs emscripten-cache's own cert (packages/emscripten-cache/cert/check.mjs)
// on that published version: every library present, no build path, and C/C++
// programs that use what the headers declare (epoll_create1, ppoll) link
// against the frozen sysroot and run.
//   node packages/wasm-emscripten/test/pinned-cache.mjs --tarball <package.tgz | npm spec>
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { peerTarball } from '../../../scripts/peer-tarball.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const spec = args[args.indexOf('--tarball') + 1];
if (!args.includes('--tarball') || !spec) {
  console.error('usage: pinned-cache.mjs --tarball <wasm-emscripten package.tgz | npm spec>');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'wasm-emscripten-pinned-cache-'));
let code = 1;
try {
  let tgz = resolve(spec);
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(work, execFileSync('npm', ['pack', '--silent', '--pack-destination', work, spec]).toString().trim().split('\n').pop());
  }
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json']).toString());
  const pin = manifest.dependencies?.['@ai-ecoverse/emscripten-cache'];
  if (!/^\d+\.\d+\.\d+-\d+$/.test(pin || '')) throw new Error(`${manifest.name}@${manifest.version} does not pin @ai-ecoverse/emscripten-cache exactly: ${pin}`);
  console.log(`== ${manifest.name}@${manifest.version} pins @ai-ecoverse/emscripten-cache@${pin}`);
  const recipe = JSON.parse(readFileSync(join(root, 'packages/emscripten-cache/package/package.json'), 'utf8')).version;
  const cacheSpec = pin === recipe ? peerTarball('emscripten-cache') : `@ai-ecoverse/emscripten-cache@${pin}`;
  console.log(`   checking ${cacheSpec}`);
  const r = spawnSync(process.execPath, [join(root, 'packages/emscripten-cache/cert/check.mjs'), '--tarball', cacheSpec, '--member-order'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const out = r.stdout.toString();
  process.stdout.write(out);
  if (r.status !== 0 || !/^PASS /m.test(out)) throw new Error(`the pinned emscripten-cache ${pin} fails its cert against this tree`);
  console.log(`PASS ${manifest.name}@${manifest.version}: its pinned emscripten-cache ${pin} passes emscripten-cache's cert`);
  code = 0;
} catch (e) {
  console.log(`FAIL ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
