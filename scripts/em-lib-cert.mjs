#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const name = args[0];
if (!name || name.startsWith('-') || !arg('--tarball')) {
  console.error('usage: em-lib-cert.mjs <recipe> --tarball <package.tgz | npm spec>');
  process.exit(2);
}
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString();
const pkgDir = join(root, 'packages', name);
const meta = JSON.parse(readFileSync(join(pkgDir, 'cert/meta.json'), 'utf8'));
const recipe = JSON.parse(sh(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--json']));

function unpack(spec, dir) {
  mkdirSync(dir, { recursive: true });
  let tgz = resolve(spec);
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, spec]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', dir]);
  return { pkg: join(dir, 'package'), tgz };
}

const work = mkdtempSync(join(tmpdir(), `${name}-em-lib-cert-`));
try {
  const { pkg, tgz } = unpack(arg('--tarball'), join(work, 'self'));
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  console.log(`== ${manifest.name}@${manifest.version} (${tgz})`);
  const pcDirs = [join(pkg, 'lib/pkgconfig')];
  const deps = (recipe.dependencies?.build ?? []).filter((d) => d.startsWith('@ai-ecoverse/'));
  for (const [i, dep] of deps.entries()) {
    const d = unpack(dep, join(work, `dep-${i}`));
    pcDirs.push(join(d.pkg, 'lib/pkgconfig'));
    console.log(`== build input ${dep}`);
  }
  for (const d of pcDirs) assert.ok(existsSync(d), `${d.replace(work, '<work>')}: no lib/pkgconfig`);

  const env = { ...process.env };
  for (const line of sh('bash', [join(root, 'scripts/install-emsdk.sh')]).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').replace(/\$\{?PATH\}?/, env.PATH);
  }
  console.log(`== ${sh('emcc', ['--version'], { env }).split('\n')[0]}`);
  const pcEnv = { ...env, PKG_CONFIG_LIBDIR: pcDirs.join(':'), PKG_CONFIG_PATH: '' };
  const mods = meta.pkgconfig;
  assert.ok(Array.isArray(mods) && mods.length, 'cert/meta.json pkgconfig: the .pc modules the probe compiles with');
  const version = sh('pkg-config', ['--modversion', mods[0]], { env: pcEnv }).trim();
  assert.equal(version, recipe.version, `${mods[0]}.pc Version is the recipe version`);
  const flags = sh('pkg-config', ['--cflags', '--libs', '--static', ...mods], { env: pcEnv }).trim().split(/\s+/).filter(Boolean);
  console.log(`== pkg-config ${mods.join(' ')}: ${flags.join(' ').replaceAll(work, '<work>')}`);
  const run = join(work, 'run');
  mkdirSync(run);
  sh('emcc', ['-O2', join(pkgDir, 'test/probe.c'), ...flags, '-Wl,--fatal-warnings', '-sENVIRONMENT=node', '-sNODERAWFS=1', '-o', join(run, 'probe.js')], { env });
  let stdout;
  try {
    stdout = sh(process.execPath, [join(run, 'probe.js'), run], { cwd: run });
  } catch (e) {
    const out = `${e.stdout ?? ''}`.trim();
    throw new Error(`test/probe.c exited ${e.status ?? e.signal}${out ? `:\n${out}` : ' with no output'}`);
  }
  console.log(stdout.trim().split('\n').map((l) => `   ${l}`).join('\n'));
  assert.match(stdout, /^probe ok$/m, 'every check in test/probe.c passed');
  const check = join(pkgDir, 'test/check.mjs');
  if (existsSync(check)) await (await import(pathToFileURL(check).href)).default({ assert, dir: run, stdout, version: recipe.version });
  console.log(`PASS ${manifest.name}@${manifest.version}: test/probe.c links with -Wl,--fatal-warnings from ${mods.join(', ')}.pc and the recipe's build inputs, and its checks pass`);
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
