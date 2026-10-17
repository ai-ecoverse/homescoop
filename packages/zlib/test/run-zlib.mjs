#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
if (!arg('--tarball')) {
  console.error('usage: run-zlib.mjs --tarball <wasm-zlib package.tgz | npm spec>');
  process.exit(2);
}
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString();

const work = mkdtempSync(join(tmpdir(), 'wasm-zlib-cert-'));
try {
  let tgz = resolve(arg('--tarball'));
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(work, sh('npm', ['pack', '--silent', '--pack-destination', work, arg('--tarball')]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', work]);
  const pkg = join(work, 'package');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const upstream = manifest.homescoop.upstream;
  console.log(`== ${manifest.name}@${manifest.version} (${tgz})`);

  const env = { ...process.env };
  for (const line of sh('bash', [join(root, 'scripts/install-emsdk.sh')]).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
    v = v.replace(/\$\{?PATH\}?/, env.PATH);
    env[m[1]] = v;
  }
  console.log(`== ${sh('emcc', ['--version'], { env }).split('\n')[0]}`);

  const pcEnv = { ...env, PKG_CONFIG_LIBDIR: join(pkg, 'lib/pkgconfig'), PKG_CONFIG_PATH: '' };
  const version = sh('pkg-config', ['--modversion', 'zlib'], { env: pcEnv }).trim();
  assert.equal(version, upstream, 'zlib.pc Version is the recipe upstream');
  const flags = sh('pkg-config', ['--cflags', '--libs', '--static', 'zlib'], { env: pcEnv }).trim().split(/\s+/).filter(Boolean);
  console.log(`== pkg-config zlib: ${flags.join(' ').replaceAll(pkg, '<package>')}`);
  const run = join(work, 'run');
  mkdirSync(run);
  sh('emcc', ['-O2', join(here, 'zprobe.c'), ...flags, '-Wl,--fatal-warnings', '-sENVIRONMENT=node', '-sNODERAWFS=1', '-o', join(run, 'zprobe.js')], { env });
  const out = sh(process.execPath, [join(run, 'zprobe.js')], { cwd: run });
  console.log(out.trim().split('\n').map((l) => `   ${l}`).join('\n'));
  assert.match(out, new RegExp(`^zlib ${upstream.replaceAll('.', '\\.')}$`, 'm'), 'zlibVersion() is the recipe upstream');
  assert.match(out, /^zprobe ok$/m, 'every zlib check in zprobe.c passed');

  const gz = readFileSync(join(run, 'probe.gz'));
  assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b], 'probe.gz has the gzip magic');
  const want = Buffer.alloc(65536);
  for (let i = 0; i < want.length; i++) want[i] = 'homescoop'.charCodeAt(i % 9) ^ ((i >> 8) & 0xff);
  assert.ok(gunzipSync(gz).equals(want), "Node's own zlib inflates the wasm zlib's probe.gz to the probe's 64 KiB");
  console.log(`PASS ${manifest.name}@${manifest.version}: zprobe links with -Wl,--fatal-warnings from the package's zlib.pc alone, its checks pass, and its probe.gz (${gz.length} bytes) is real gzip`);
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
