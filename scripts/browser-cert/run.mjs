#!/usr/bin/env node
/**
 * Browser-cert a homescoop package tarball on slicc-kernel via CDP/Chromium
 * (@ai-ecoverse/slicc-shared-web/harness).
 *
 *   node scripts/browser-cert/run.mjs --package jq --tarball .homescoop-out/package.tgz
 *
 * Skips (exit 0) when the package has no emscripten slicc.commands (libs use
 * host-smoke.sh). Fails when a CLI does not meet browser-cert.json / defaults.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

const pkgName = flag('--package');
const tarball = resolve(flag('--tarball') || '.homescoop-out/package.tgz');
if (!pkgName) {
  console.error('usage: run.mjs --package <name> --tarball <package.tgz>');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), `homescoop-bcert-${pkgName}-`));
const extract = join(work, 'pkg');
mkdirSync(extract, { recursive: true });

const untar = spawnSync('tar', ['-xzf', tarball, '-C', extract], { encoding: 'utf8' });
if (untar.status !== 0) {
  console.error(`browser-cert: tar failed: ${untar.stderr || untar.stdout}`);
  process.exit(1);
}

const pkgRoot = join(extract, 'package');
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const npmName = manifest.name;
const abi = manifest.slicc?.abi;
const commands = manifest.slicc?.commands || {};
const cmdNames = Object.keys(commands);

function cleanup(code) {
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

if (abi && abi !== 'emscripten') {
  console.log(`browser-cert: skip ${npmName} (abi=${abi}; emscripten CDP cert only)`);
  cleanup(0);
}
if (cmdNames.length === 0) {
  console.log(`browser-cert: skip ${npmName} (no slicc.commands; lib cert is host-smoke)`);
  cleanup(0);
}

/** @returns {{ argv: string[], status?: number, stdout?: string, stderrIncludes?: string, cwd?: string }} */
function loadPlan() {
  const explicit = join(root, 'packages', pkgName, 'browser-cert.json');
  try {
    return JSON.parse(readFileSync(explicit, 'utf8'));
  } catch {
    /* default */
  }
  return { argv: [cmdNames[0], '--version'], status: 0 };
}

const plan = loadPlan();
if (!Array.isArray(plan.argv) || plan.argv.length === 0) {
  console.error('browser-cert: plan.argv required');
  cleanup(1);
}

const installDir = `node_modules/${npmName}/`;

function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(abs.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

const fileNames = listFiles(pkgRoot);
writeFileSync(
  join(work, 'plan.json'),
  JSON.stringify({ npmName, installDir, fileNames, plan }, null, 2),
);

function resolveNodeModules() {
  const candidates = [
    process.env.HOMESCOOP_CERT_NODE_MODULES,
    join(here, 'node_modules'),
    join(root, 'node_modules'),
  ].filter(Boolean);
  for (const base of candidates) {
    try {
      readFileSync(join(base, '@ai-ecoverse/slicc-shared-web/harness/index.mjs'));
      return base;
    } catch {
      /* try next */
    }
  }
  console.error(
    'browser-cert: @ai-ecoverse/slicc-shared-web not found. Install into scripts/browser-cert or set HOMESCOOP_CERT_NODE_MODULES.',
  );
  cleanup(1);
}

const nodeModules = resolveNodeModules();
const { launch } = await import(
  pathToFileURL(join(nodeModules, '@ai-ecoverse/slicc-shared-web/harness/index.mjs')).href
);

const kernelDist = join(nodeModules, '@ai-ecoverse/slicc-kernel/dist');
try {
  readFileSync(join(kernelDist, 'index.js'));
} catch {
  console.error('browser-cert: @ai-ecoverse/slicc-kernel/dist/index.js missing');
  cleanup(1);
}

const chrome = await launch({
  roots: [
    ['/dist/', `${kernelDist}/`],
    [`/${installDir}`, `${pkgRoot}/`],
    ['/', `${here}/page/`],
  ],
  isolated: true,
  exits: { '/dist/process-worker.js': [/WASM_PROCESS_EXIT, code/, /WASM_PROCESS_ERROR,$/] },
});

const t = {
  name: `browser-cert:${pkgName}`,
  filePath: 'browser-cert',
  after(fn) {
    this._after = fn;
  },
};

try {
  const page = await chrome.page(t);
  await page.goto('/');
  await page.until(() => typeof window.boot === 'function');
  await page.evaluate(() => window.boot());
  await page.evaluate((d, n) => window.installTree(d, n), installDir, fileNames);

  const result = await page.evaluate(
    (argv, cwd) => window.kernel.run(argv, { cwd }),
    plan.argv,
    plan.cwd || '/home',
  );

  const expectStatus = plan.status ?? 0;
  if (result.status !== expectStatus) {
    console.error(
      `browser-cert: status ${result.status} != ${expectStatus}\nstdout: ${JSON.stringify(result.stdout)}\nstderr: ${JSON.stringify(result.stderr)}`,
    );
    process.exitCode = 1;
  } else if (plan.stdout != null && result.stdout !== plan.stdout) {
    console.error(
      `browser-cert: stdout mismatch\nwant: ${JSON.stringify(plan.stdout)}\ngot:  ${JSON.stringify(result.stdout)}\nstderr: ${JSON.stringify(result.stderr)}`,
    );
    process.exitCode = 1;
  } else if (plan.stderrIncludes && !result.stderr.includes(plan.stderrIncludes)) {
    console.error(
      `browser-cert: stderr missing ${JSON.stringify(plan.stderrIncludes)}\nstderr: ${JSON.stringify(result.stderr)}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `browser-cert: ok ${npmName} argv=${JSON.stringify(plan.argv)} status=${result.status}`,
    );
    if (result.stdout) console.log(`stdout: ${JSON.stringify(result.stdout)}`);
  }

  if (typeof t._after === 'function') await t._after();
} finally {
  await chrome.close();
  rmSync(work, { recursive: true, force: true });
}

process.exit(process.exitCode ?? 0);
