#!/usr/bin/env node
/**
 * Browser-cert / CI-cert a homescoop package tarball.
 *
 *   node scripts/browser-cert/run.mjs --package jq --tarball .homescoop-out/package.tgz
 *
 * Prefer packages/<name>/cert/*.mjs (full checklist). Fall back to
 * browser-cert.json / --version smoke when no cert/ specs exist.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeContext } from './context.mjs';

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

const certDir = join(root, 'packages', pkgName, 'cert');
const certSpecs = existsSync(certDir)
  ? readdirSync(certDir)
      .filter((f) => f.endsWith('.mjs'))
      .sort()
      .map((f) => join(certDir, f))
  : [];

const metaPath = join(certDir, 'meta.json');
/** @type {{ harness?: string, needs?: string[] }} */
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const harness = meta.harness || (certSpecs.length ? 'slicc-kernel' : 'smoke');

if (harness === 'host-smoke' || harness === 'host-node') {
  console.log(`browser-cert: ${pkgName} harness=${harness} — delegated to ladder-pr host steps`);
  process.exit(0);
}
if (harness === 'slicc-realm') {
  console.error(
    `browser-cert: ${pkgName} requires full SLICC realm (cert/meta.json). Not wired in ladder-pr yet.`,
  );
  process.exit(1);
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
const abi = manifest.slicc?.abi || 'emscripten';
const commands = manifest.slicc?.commands || {};
const cmdNames = Object.keys(commands);

function cleanup(code) {
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

// Full cert specs may target wasi (python wheels, wasi-pnpm). Smoke-only path
// still skips non-emscripten without cert/.
if (certSpecs.length === 0) {
  if (abi !== 'emscripten') {
    console.log(`browser-cert: skip ${npmName} (abi=${abi}; no cert/*.mjs)`);
    cleanup(0);
  }
  if (cmdNames.length === 0) {
    console.log(`browser-cert: skip ${npmName} (no slicc.commands; lib cert is host-smoke)`);
    cleanup(0);
  }
}

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
    'browser-cert: @ai-ecoverse/slicc-shared-web not found. Set HOMESCOOP_CERT_NODE_MODULES.',
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

const installDir = `node_modules/${npmName}/`;
const fileNames = listFiles(pkgRoot);

/** @type {[string, string][]} */
const roots = [
  ['/dist/', `${kernelDist}/`],
  [`/${installDir}`, `${pkgRoot}/`],
  ['/', `${here}/page/`],
];

// Optional peer packages from npm (e.g. wasm-bash) for shell-based certs.
for (const need of meta.needs || []) {
  const needRoot = join(nodeModules, need);
  if (!existsSync(join(needRoot, 'package.json'))) {
    console.error(`browser-cert: cert needs ${need} under HOMESCOOP_CERT_NODE_MODULES`);
    cleanup(1);
  }
  roots.splice(1, 0, [`/node_modules/${need}/`, `${needRoot}/`]);
}

const chrome = await launch({
  roots,
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
  // Peers first, package under test last so its slicc.commands win on name
  // collisions (e.g. wasm-coreutils advertises uptime/kill without those
  // multi-call applets; wasm-procps must own those names in its cert).
  for (const need of meta.needs || []) {
    const needRoot = join(nodeModules, need);
    const names = listFiles(needRoot);
    await page.evaluate(
      (d, n) => window.installTree(d, n),
      `node_modules/${need}/`,
      names,
    );
  }
  await page.evaluate((d, n) => window.installTree(d, n), installDir, fileNames);

  if (certSpecs.length > 0) {
    const ctx = makeContext(page, { packageName: pkgName, npmName });
    for (const specPath of certSpecs) {
      const mod = await import(pathToFileURL(specPath).href);
      const fn = mod.default;
      if (typeof fn !== 'function') {
        console.error(`browser-cert: ${specPath} must default-export async function`);
        process.exitCode = 1;
        continue;
      }
      const label = specPath.slice(root.length + 1);
      try {
        await fn(ctx);
        console.log(`browser-cert: ok ${label}`);
      } catch (err) {
        console.error(`browser-cert: FAIL ${label}`);
        console.error(err);
        process.exitCode = 1;
      }
    }
  } else {
    /** @type {{ argv: string[], status?: number, stdout?: string, cwd?: string }} */
    let plan;
    try {
      plan = JSON.parse(readFileSync(join(root, 'packages', pkgName, 'browser-cert.json'), 'utf8'));
    } catch {
      plan = { argv: [cmdNames[0], '--version'], status: 0 };
    }
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
        `browser-cert: stdout mismatch\nwant: ${JSON.stringify(plan.stdout)}\ngot:  ${JSON.stringify(result.stdout)}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `browser-cert: smoke ok ${npmName} argv=${JSON.stringify(plan.argv)} (not CI-certified — add cert/*.mjs)`,
      );
    }
  }

  if (page.errors?.length) {
    console.error('browser-cert: page errors', page.errors);
    process.exitCode = 1;
  }

  if (typeof t._after === 'function') await t._after();
} finally {
  await chrome.close();
  rmSync(work, { recursive: true, force: true });
}

process.exit(process.exitCode ?? 0);
