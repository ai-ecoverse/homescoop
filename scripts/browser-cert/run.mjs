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
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { recorder } from './cases.mjs';
import { certMetaFile, pathLabel, readCertMeta } from './cert-meta.mjs';
import { makeContext } from './context.mjs';
import { glueByPath, glueCheckPlan, glueStep, runMode } from './glue.mjs';
import { checkTarballNotices } from './tarball-notices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

function flags(name) {
  return process.argv.flatMap((arg, i) => (arg === name && i + 1 < process.argv.length ? [process.argv[i + 1]] : []));
}

const USERS = ['off', 'report', 'enforce'];
const pkgName = flag('--package');
const tarballs = (flags('--tarball').length ? flags('--tarball') : ['.homescoop-out/package.tgz']).map((t) => resolve(t));
const kernelFlag = flag('--kernel');
const usersFlag = flag('--users');
const jsonOut = flag('--json') ? resolve(flag('--json')) : '';
const soft = process.argv.includes('--soft');
// --glue-only: only glue by path (#360), on this kernel and users mode; for a
// package whose cert kernel cannot run it (cert-leg.mjs browser-extra, homescoop#628).
const glueOnly = process.argv.includes('--glue-only');
const livePort = Number(flag('--live')) || 0;
if (!pkgName) {
  console.error(
    'usage: run.mjs --package <name> --tarball <package.tgz> [--tarball <more.tgz>] [--cert <dir>] [--kernel <npm spec | kernel .tgz | dir>] [--users off|report|enforce] [--json <out.json>] [--soft] [--spec <file.mjs> ...] [--live <port>] [--glue-only]',
  );
  process.exit(2);
}
if (usersFlag && !USERS.includes(usersFlag)) {
  console.error(`browser-cert: --users must be one of ${USERS.join(', ')}`);
  process.exit(2);
}

const certDir = flag('--cert') ? resolve(flag('--cert')) : join(root, 'packages', pkgName, 'cert');
const only = flags('--spec');
const allSpecs = existsSync(certDir) ? readdirSync(certDir).filter((f) => f.endsWith('.mjs')).sort() : [];
const missing = only.filter((f) => !allSpecs.includes(f));
if (missing.length) {
  console.error(`browser-cert: --spec ${missing.join(', ')}: not in ${certDir}`);
  process.exit(2);
}
const certSpecs = allSpecs.filter((f) => !only.length || only.includes(f)).map((f) => join(certDir, f));

const { file: metaFile, fallback: metaFallback } = certMetaFile(root, pkgName, certDir);
let metaError = null;
/** @type {{ harness?: string, needs?: string[] }} */
let meta = {};
if (metaFile) {
  try {
    meta = readCertMeta(metaFile, pathLabel(root, metaFile));
  } catch (err) {
    metaError = err.message;
  }
  console.log(
    `browser-cert: meta ${pathLabel(root, metaFile)}${metaFallback ? ` (${pathLabel(root, certDir)} has no meta.json)` : ''}`,
  );
}
const harness = meta.harness || (certSpecs.length ? 'slicc-kernel' : 'smoke');
const users = usersFlag || meta.users || '';

const report = {
  package: pkgName,
  cert: relative(root, certDir),
  meta: metaFile ? pathLabel(root, metaFile) : null,
  harness,
  users: users || null,
  kernel: null,
  tarballs: [],
  specs: [],
  pageErrors: [],
  modes: null,
  error: null,
  status: 'fail',
};

function writeReport(status) {
  const what = `${pkgName} ${status}${report.error ? `: ${String(report.error).split('\n')[0].slice(0, 160)}` : ''}`;
  console.log(status === 'fail' ? `cert-run: FAIL ${what}` : `cert-run: PASS ${what}`);
  if (!jsonOut) return;
  report.status = status;
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
}

function errorText(err) {
  return String(err?.stack || err).slice(0, 8000);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (metaError) {
  console.error(`browser-cert: ${metaError}`);
  report.error = metaError;
  writeReport('fail');
  process.exit(1);
}
if (harness === 'host-smoke' || harness === 'host-node') {
  console.log(`browser-cert: ${pkgName} harness=${harness} — delegated to the PR run host steps`);
  writeReport('skip');
  process.exit(0);
}
if (harness === 'slicc-realm') {
  console.error(
    `browser-cert: ${pkgName} requires full SLICC realm (cert/meta.json). Not wired in the PR run yet.`,
  );
  report.error = 'harness slicc-realm is not wired';
  writeReport('fail');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), `homescoop-bcert-${pkgName}-`));

function cleanup(code, status = code === 0 ? 'pass' : 'fail') {
  writeReport(status);
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

function untar(tgz, into) {
  mkdirSync(into, { recursive: true });
  const r = spawnSync('tar', ['-xpzf', tgz, '-C', into], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`browser-cert: tar failed: ${r.stderr || r.stdout}`);
    report.error = `tar -xzf ${tgz} failed`;
    cleanup(1);
  }
  return join(into, 'package');
}

const pkgs = tarballs.map((tgz, i) => {
  const pkgRoot = untar(tgz, join(work, `pkg${i}`));
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  const entry = { name: manifest.name, version: manifest.version, sha256: sha256(tgz), tarball: tgz };
  report.tarballs.push(entry);
  return { ...entry, pkgRoot, manifest, installDir: `node_modules/${manifest.name}/` };
});
const [main] = pkgs;
const { pkgRoot, manifest } = main;
const npmName = manifest.name;
const abi = manifest.slicc?.abi || 'emscripten';
const commands = manifest.slicc?.commands || {};
const cmdNames = Object.keys(commands);

// Full cert specs may target wasi (python wheels, wasi-pnpm). Smoke-only path
// still skips non-emscripten without cert/.
const mode = runMode({ glueOnly, specs: certSpecs.length, abi, commands: cmdNames.length });
if (mode.mode === 'skip') {
  console.log(`browser-cert: skip ${npmName} (${mode.why})`);
  cleanup(0, 'skip');
}

if (soft || livePort || glueOnly) {
  console.log(`browser-cert: tarball notices skipped: ${soft ? '--soft' : livePort ? '--live' : '--glue-only'}`);
} else {
  const tn = checkTarballNotices({ root, pkgName, pkgRoot, manifest });
  if (tn.skipped) {
    console.log(`notices: PASS ${npmName}: ${tn.skipped}`);
    report.specs.push({ spec: 'tarball-notices', status: 'pass', durationMs: 0 });
  } else if (tn.errors.length) {
    console.error(`browser-cert: FAIL tarball notices (homescoop#893, #906): ${tn.errors.join('; ')}`);
    console.log(`notices: FAIL ${npmName}: ${tn.errors.length} problem(s)`);
    report.specs.push({ spec: 'tarball-notices', status: 'fail', durationMs: 0, error: tn.errors.join('; ') });
    process.exitCode = 1;
  } else {
    console.log(`notices: PASS ${npmName}: ${tn.sections.length} section(s)${tn.required.length ? `, including ${tn.required.join(' and ')}` : ''}`);
    report.specs.push({ spec: 'tarball-notices', status: 'pass', durationMs: 0 });
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

function modesOf(base, names) {
  const modes = {};
  for (const name of names) {
    const mode = statSync(join(base, name)).mode & 0o7777;
    if (mode !== 0o644 || name.startsWith('bin/')) modes[name] = mode;
  }
  return modes;
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
  report.error = '@ai-ecoverse/slicc-shared-web not found';
  cleanup(1);
}

function kernelFrom(spec) {
  const dir = join(work, 'kernel');
  mkdirSync(dir, { recursive: true });
  const local = existsSync(spec) ? resolve(spec) : '';
  if (local && statSync(local).isDirectory()) {
    const m = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8'));
    return { dist: join(local, 'dist'), info: { name: m.name, version: m.version, source: local } };
  }
  let tgz = local;
  if (!tgz) {
    const r = spawnSync('npm', ['pack', spec, '--pack-destination', dir, '--json'], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`browser-cert: npm pack ${spec} failed: ${r.stderr}`);
      report.error = `npm pack ${spec} failed`;
      cleanup(1);
    }
    tgz = join(dir, JSON.parse(r.stdout)[0].filename);
  }
  const unpacked = untar(tgz, join(dir, 'x'));
  const m = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'));
  return {
    dist: join(unpacked, 'dist'),
    info: { name: m.name, version: m.version, sha256: sha256(tgz), source: local ? basename(local) : spec },
  };
}

const nodeModules = resolveNodeModules();
const { launch } = await import(
  pathToFileURL(join(nodeModules, '@ai-ecoverse/slicc-shared-web/harness/index.mjs')).href
);
let kernelDist = join(nodeModules, '@ai-ecoverse/slicc-kernel/dist');
if (kernelFlag) {
  const k = kernelFrom(kernelFlag);
  kernelDist = k.dist;
  report.kernel = k.info;
} else {
  try {
    const m = JSON.parse(readFileSync(join(kernelDist, '../package.json'), 'utf8'));
    report.kernel = { name: m.name, version: m.version, source: 'HOMESCOOP_CERT_NODE_MODULES' };
  } catch {
    report.kernel = null;
  }
}
try {
  readFileSync(join(kernelDist, 'index.js'));
} catch {
  console.error(`browser-cert: ${kernelDist}/index.js missing`);
  report.error = 'kernel dist/index.js missing';
  cleanup(1);
}
if (report.kernel) {
  console.log(
    `browser-cert: kernel ${report.kernel.name}@${report.kernel.version}${report.kernel.sha256 ? ` sha256 ${report.kernel.sha256}` : ''} users ${users || 'kernel default'}`,
  );
}

/** @type {[string, string][]} */
const roots = [
  ['/dist/', `${kernelDist}/`],
  ...pkgs.map((p) => [`/${p.installDir}`, `${p.pkgRoot}/`]),
  ['/', `${here}/page/`],
];

// Optional peer packages from npm (e.g. wasm-bash) for shell-based certs.
for (const need of meta.needs || []) {
  const needRoot = join(nodeModules, need);
  if (!existsSync(join(needRoot, 'package.json'))) {
    console.error(`browser-cert: cert needs ${need} under HOMESCOOP_CERT_NODE_MODULES`);
    report.error = `cert needs ${need}`;
    cleanup(1);
  }
  roots.splice(1, 0, [`/node_modules/${need}/`, `${needRoot}/`]);
}

let chrome;
try {
  chrome = await launch({
    roots,
    isolated: true,
    realistic: Boolean(livePort && process.env.DISPLAY),
    timeout: Number(meta.runTimeoutMs) || 120000,
    exits: { '/dist/process-worker.js': [/WASM_PROCESS_EXIT, code/, /WASM_PROCESS_ERROR,$/] },
  });
} catch (err) {
  console.error('browser-cert: FAIL chrome launch');
  console.error(err);
  report.error = errorText(err);
  cleanup(1);
}

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
  const uplinkNameserver = typeof meta.uplink?.nameserver === 'string' ? meta.uplink.nameserver : undefined;
  await page.evaluate((o) => window.boot(o), {
    uplink: meta.uplink === true || uplinkNameserver !== undefined,
    ...(uplinkNameserver ? { uplinkNameserver } : {}),
    ...(users ? { users } : {}),
  });
  // Peers first, package under test last so its slicc.commands win on name
  // collisions (e.g. wasm-coreutils advertises uptime/kill without those
  // multi-call applets; wasm-procps must own those names in its cert).
  for (const need of meta.needs || []) {
    const needRoot = join(nodeModules, need);
    const names = listFiles(needRoot);
    const done = await page.evaluate(
      (d, n, m) => window.installTree(d, n, m),
      `node_modules/${need}/`,
      names,
      modesOf(needRoot, names),
    );
    report.modes = done.stamped === null ? 'kernel defaults' : 'tarball';
  }
  for (const p of pkgs) {
    const names = listFiles(p.pkgRoot);
    const done = await page.evaluate((d, n, m) => window.installTree(d, n, m), p.installDir, names, modesOf(p.pkgRoot, names));
    report.modes = done.stamped === null ? 'kernel defaults' : 'tarball';
  }
  console.log(`browser-cert: file modes: ${report.modes === 'tarball' ? 'the tarballs\' (kernel.chmod)' : 'the kernel\'s defaults (no kernel.chmod)'}`);

  if (livePort) {
    const ctx = makeContext(page, { packageName: pkgName, npmName });
    const { createServer } = await import('node:http');
    const answer = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(`${JSON.stringify(body)}\n`);
    };
    const info = {
      package: npmName,
      versions: pkgs.map((p) => `${p.manifest.name}@${p.manifest.version}`),
      kernel: report.kernel,
      users: users || null,
      modes: report.modes,
      calls: Object.keys(ctx).filter((key) => typeof ctx[key] === 'function'),
    };
    createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/') return answer(res, 200, info);
      const name = req.url.match(/^\/ctx\/([A-Za-z]+)$/)?.[1];
      if (req.method !== 'POST' || typeof ctx[name] !== 'function') return answer(res, 404, { error: 'GET / or POST /ctx/<call> with a JSON array of arguments' });
      let args = [];
      try {
        const text = await new Promise((done) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => done(body));
        });
        args = text.trim() ? JSON.parse(text) : [];
        if (!Array.isArray(args)) throw new Error('the body must be a JSON array of arguments');
        answer(res, 200, (await ctx[name](...args)) ?? null);
      } catch (err) {
        answer(res, 500, { error: errorText(err) });
      }
    }).listen(livePort, '127.0.0.1', () => console.log(`browser-cert: live on http://127.0.0.1:${livePort}/ ${JSON.stringify(info)}`));
    await new Promise(() => {});
  }

  if (mode.mode === 'glue-only') {
    console.log('browser-cert: --glue-only: no specs, glue by path only');
  } else if (mode.mode === 'specs') {
    const ctx = {
      ...makeContext(page, { packageName: pkgName, npmName }),
      installed: pkgs.map((p) => p.manifest),
      kernel: report.kernel,
      users: users || null,
    };
    for (const specPath of certSpecs) {
      const mod = await import(pathToFileURL(specPath).href);
      const fn = mod.default;
      const spec = basename(specPath);
      if (typeof fn !== 'function') {
        console.error(`browser-cert: ${specPath} must default-export async function`);
        report.specs.push({ spec, status: 'fail', durationMs: 0, error: 'no default export' });
        process.exitCode = 1;
        continue;
      }
      const label = pathLabel(root, specPath);
      const started = Date.now();
      const rec = recorder(ctx.assert, { soft, roots: [join(root, 'packages'), certDir], root });
      try {
        await fn({ ...ctx, assert: rec.assert });
        const failed = rec.cases.fail;
        if (failed.length) {
          console.error(`browser-cert: FAIL ${label} (${failed.length} of ${failed.length + rec.cases.pass.length} assertions)`);
          for (const f of failed) console.error(`  ${f.id}: ${f.message}`);
          process.exitCode = 1;
        } else console.log(`browser-cert: ok ${label}`);
        report.specs.push({
          spec,
          status: failed.length ? 'fail' : 'pass',
          durationMs: Date.now() - started,
          cases: rec.cases,
          ...(failed.length ? { error: failed.map((f) => `${f.id}: ${f.message}`).join('\n') } : {}),
        });
      } catch (err) {
        const crash = rec.isAssertion(err) ? null : rec.crash(err);
        console.error(`browser-cert: FAIL ${label}${crash ? ` (crash at ${crash.where || '?'})` : ''}`);
        console.error(err);
        report.specs.push({
          spec,
          status: 'fail',
          durationMs: Date.now() - started,
          error: errorText(err),
          cases: rec.cases,
          ...(crash ? { crash } : {}),
        });
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
    report.specs.push({ spec: 'smoke', status: process.exitCode ? 'fail' : 'pass', durationMs: 0 });
  }

  const glue = glueCheckPlan({ soft, live: Boolean(livePort), modes: report.modes, users, kernelVersion: report.kernel?.version, meta, manifest });
  const step = glueStep({ glueOnly, plan: glue });
  if (step.action === 'run') {
    const sp = await glueByPath(makeContext(page, { packageName: pkgName, npmName }), { installDir: main.installDir, targets: glue.targets });
    report.specs.push(sp);
    if (sp.status === 'fail') {
      console.error(`browser-cert: FAIL glue by path (#360): ${sp.error}`);
      process.exitCode = 1;
    } else console.log(`browser-cert: ok glue by path (#360): ${glue.targets.length} glue file(s) run as certglue under users enforce`);
  } else if (step.action === 'fail') {
    console.error(`browser-cert: FAIL ${step.why}`);
    report.specs.push({ spec: 'glue-by-path', status: 'fail', durationMs: 0, error: step.why });
    process.exitCode = 1;
  } else if (step.log) console.log(`browser-cert: glue by path skipped: ${step.why}`);

  if (page.errors?.length) {
    console.error('browser-cert: page errors', page.errors);
    report.pageErrors = page.errors.map((e) => String(e).slice(0, 2000));
    process.exitCode = 1;
  }

  if (typeof t._after === 'function') await t._after();
} catch (err) {
  console.error('browser-cert: FAIL boot');
  console.error(err);
  report.error = errorText(err);
  process.exitCode = 1;
} finally {
  await chrome.close();
  rmSync(work, { recursive: true, force: true });
}

writeReport(process.exitCode ? 'fail' : 'pass');
process.exit(process.exitCode ?? 0);
