#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCertMeta } from './cert-meta.mjs';
import { glueFallback } from './glue.mjs';
import { devPin } from '../dev-pin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOST_HARNESSES = ['host-node', 'host-smoke'];

function readMeta(dir, pkg) {
  const meta = readCertMeta(join(dir, 'packages', pkg, 'cert', 'meta.json'), `packages/${pkg}/cert/meta.json`);
  if (meta.ci !== undefined && !Array.isArray(meta.ci)) {
    throw new Error(`packages/${pkg}/cert/meta.json: ci is not a list of commands; nothing was certified`);
  }
  const blank = (meta.ci || []).findIndex((c) => typeof c !== 'string' || !c.trim());
  if (blank >= 0) {
    throw new Error(`packages/${pkg}/cert/meta.json: ci entry ${blank} is not a command; nothing was certified`);
  }
  readPeers(dir, pkg, meta);
  readExtraKernels(dir, pkg, meta);
  return meta;
}

const KERNEL_SPEC = /^@ai-ecoverse\/slicc-kernel@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SPEC_FILE = /^[\w.-]+\.mjs$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

// cert/meta.json "extra_kernels" (homescoop#663). A string entry documents
// a kernel the specs were checked on by hand; ladder-pr does not run it. An
// object entry is run by ladder-pr's cert leg:
//   { "kernel": "@ai-ecoverse/slicc-kernel@x.y.z", "why": "...",
//     "specs": true | ["a.mjs", ...],  // browser specs on that kernel
//     "cert": "k108",                  // optional: a cert/ subdirectory
//     "users": "enforce",              // optional --users override
//     "env": { "TAR_LINKAT": "1" },    // optional, for specs and ci
//     "ci": ["<command>", ...] }       // host commands, with
//                                      // HOMESCOOP_CERT_KERNEL=<kernel>
export function readExtraKernels(dir, pkg, meta) {
  const list = meta.extra_kernels;
  if (list === undefined) return [];
  const where = `packages/${pkg}/cert/meta.json: extra_kernels`;
  if (!Array.isArray(list)) throw new Error(`${where} is not a list; nothing was certified`);
  const runs = [];
  list.forEach((e, i) => {
    if (typeof e === 'string') return;
    const bad = (why) => {
      throw new Error(`${where}[${i}] ${why}; nothing was certified`);
    };
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad('is neither a note nor an object');
    const known = ['kernel', 'why', 'specs', 'cert', 'users', 'env', 'ci'];
    const unknown = Object.keys(e).filter((k) => !known.includes(k));
    if (unknown.length) bad(`has unknown key(s) ${unknown.join(', ')}`);
    if (typeof e.kernel !== 'string' || !KERNEL_SPEC.test(e.kernel)) bad('kernel is not an exact @ai-ecoverse/slicc-kernel@<version>');
    if (typeof e.why !== 'string' || !e.why.trim()) bad('has no why');
    if (e.specs === undefined && e.ci === undefined) bad('runs nothing (no specs, no ci); make it a string note instead');
    if (e.specs !== undefined && e.specs !== true && !(Array.isArray(e.specs) && e.specs.length && e.specs.every((f) => typeof f === 'string' && SPEC_FILE.test(f)))) {
      bad('specs is not true or a list of spec file names');
    }
    if (e.cert !== undefined && (typeof e.cert !== 'string' || !/^[\w.-]+$/.test(e.cert) || e.cert.startsWith('.') || !existsSync(join(dir, 'packages', pkg, 'cert', e.cert)))) {
      bad('cert is not a subdirectory of cert/');
    }
    if (e.cert !== undefined && e.specs === undefined) bad('names a cert directory but no specs');
    if (e.specs !== undefined) {
      const specDir = join(dir, 'packages', pkg, 'cert', e.cert || '');
      const have = existsSync(specDir) ? readdirSync(specDir).filter((f) => f.endsWith('.mjs')) : [];
      if (!have.length) bad(`specs: cert/${e.cert ? `${e.cert}/` : ''} has no *.mjs spec, so nothing would run on ${e.kernel}`);
      const absent = Array.isArray(e.specs) ? e.specs.filter((f) => !have.includes(f)) : [];
      if (absent.length) bad(`specs ${absent.join(', ')} not in cert/${e.cert ? `${e.cert}/` : ''}`);
    }
    if (e.users !== undefined && !['off', 'report', 'enforce'].includes(e.users)) bad('users is not off, report or enforce');
    if (e.env !== undefined && (!e.env || typeof e.env !== 'object' || Array.isArray(e.env) || Object.entries(e.env).some(([k, v]) => !ENV_NAME.test(k) || typeof v !== 'string'))) {
      bad('env is not an object of NAME: "string"');
    }
    if (e.ci !== undefined && (!Array.isArray(e.ci) || !e.ci.length || e.ci.some((c) => typeof c !== 'string' || !c.trim()))) bad('ci is not a list of commands');
    if (e.specs !== undefined && HOST_HARNESSES.includes(meta.harness || '')) bad(`has specs, but harness ${meta.harness} runs no browser specs (use ci)`);
    runs.push(e);
  });
  return runs;
}

const RECIPE = /^[a-z0-9][a-z0-9._-]*$/;

// cert/meta.json "peers": other recipes whose host-<peer>-prN artifacts of the
// same ladder-pr run the cert job downloads into .homescoop-out/peers, for ci
// commands that check this package against them (homescoop#678).
export function readPeers(dir, pkg, meta) {
  if (meta.peers === undefined) return [];
  const peers = meta.peers;
  if (!Array.isArray(peers) || !peers.length || peers.some((p) => typeof p !== 'string' || !RECIPE.test(p) || p === pkg)) {
    throw new Error(`packages/${pkg}/cert/meta.json: peers is not a list of other recipe names; nothing was certified`);
  }
  const missing = peers.filter((p) => !existsSync(join(dir, 'packages', p, 'recipe.yaml')));
  if (missing.length) {
    throw new Error(`packages/${pkg}/cert/meta.json: peers ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not a recipe; nothing was certified`);
  }
  return peers;
}

export function planLeg(pkg, manifest, { dir = root } = {}) {
  const certDir = join(dir, 'packages', pkg, 'cert');
  const specs = existsSync(certDir) ? readdirSync(certDir).filter((f) => f.endsWith('.mjs')) : [];
  const meta = readMeta(dir, pkg);
  const harness = meta.harness || 'smoke';
  const ci = meta.ci || [];
  let browser;
  if (meta.blocked) browser = 'blocked';
  else if (HOST_HARNESSES.includes(harness)) browser = 'skip';
  else if (specs.length) browser = 'run';
  else {
    const abi = manifest?.slicc?.abi || 'emscripten';
    const commands = Object.keys(manifest?.slicc?.commands || {}).length;
    browser = abi === 'emscripten' && commands > 0 ? 'run' : 'skip';
  }
  let error = null;
  let nothing = null;
  if (!meta.blocked && HOST_HARNESSES.includes(harness) && ci.length === 0) {
    error = `${pkg}: cert harness ${harness} declares no ci commands; nothing was certified`;
  } else if (browser !== 'run' && ci.length === 0) {
    nothing = meta.blocked
      ? `${pkg}: cert/meta.json is blocked and declares no ci commands; this cert leg certifies nothing`
      : `${pkg}: no cert specs; this cert leg certifies nothing`;
  }
  return { browser, ci, harness, specs: specs.length, error, nothing, peers: readPeers(dir, pkg, meta) };
}

function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function plan(pkg, manifestPath) {
  const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  let p;
  try {
    p = planLeg(pkg, manifest);
  } catch (err) {
    console.error(`::error::${err.message}`);
    summary(err.message);
    return 1;
  }
  if (p.browser === 'blocked') {
    console.error('::notice::browser-cert skipped — cert/meta.json blocked (needs unpublished kernel/peer); host-build still gates the PR');
  } else if (p.browser === 'skip') {
    console.error('browser-cert: skip (host-smoke/host-node or no CLI/cert specs)');
  }
  console.error(`cert leg: harness ${p.harness}, ${p.specs} spec(s), browser ${p.browser}, ${p.ci.length} ci command(s)`);
  if (p.error) {
    console.error(`::error::${p.error}`);
    summary(`${p.error}`);
    return 1;
  }
  if (p.nothing) {
    console.error(`::warning::${p.nothing}`);
    summary(`${p.nothing}`);
  }
  console.log(`browser=${p.browser}`);
  if (p.peers.length) {
    console.error(`cert leg: peers ${p.peers.join(', ')} (their artifacts of this run, if built, in .homescoop-out/peers)`);
    console.log(`peers=${p.peers.join('|')}`);
  }
  return 0;
}

function ci(pkg) {
  let meta;
  try {
    meta = readMeta(root, pkg);
  } catch (err) {
    console.log(`::error::${err.message}`);
    return 1;
  }
  const runs = [{ cmds: meta.ci || [], env: {}, label: '' }];
  for (const e of readExtraKernels(root, pkg, meta)) {
    if (e.ci) runs.push({ cmds: e.ci, env: { ...(e.env || {}), HOMESCOOP_CERT_KERNEL: e.kernel }, label: ` (extra kernel ${e.kernel})` });
  }
  if (!runs.some((r) => r.cmds.length)) {
    console.log('host cert: no ci commands');
    return 0;
  }
  for (const { cmds, env, label } of runs) {
    for (const cmd of cmds) {
      console.log(`::group::host cert${label}: ${cmd}`);
      const r = spawnSync('bash', ['-c', cmd], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
      console.log('::endgroup::');
      if (r.status !== 0) {
        console.log(`::error::${pkg}: host cert command failed${label} (${r.status ?? r.signal}): ${cmd}`);
        return r.status || 1;
      }
    }
  }
  return 0;
}

// The browser runs after the cert kernel's: glue by path on the dev-pin
// kernel when the cert kernel cannot run it (#628), and each extra_kernels
// entry with specs (#663). Returns the run.mjs invocations.
export function browserExtras(pkg, manifest, { dir = root, tarball = '.homescoop-out/package.tgz' } = {}) {
  if (planLeg(pkg, manifest, { dir }).browser !== 'run') return [];
  const meta = readMeta(dir, pkg);
  const certKernel = meta.kernel || devPin('@ai-ecoverse/slicc-kernel', { dir });
  const base = ['scripts/browser-cert/run.mjs', '--package', pkg, '--tarball', tarball];
  const out = [];
  const fallbackKernel = devPin('@ai-ecoverse/slicc-kernel', { dir });
  const glue = glueFallback({ meta, manifest, certKernel, fallbackKernel });
  if (glue) {
    out.push({ label: `glue by path on ${glue.kernel} (${glue.why})`, argv: [...base, '--kernel', glue.kernel, '--users', 'enforce', '--glue-only'], env: {} });
  }
  for (const e of readExtraKernels(dir, pkg, meta)) {
    if (e.specs === undefined) continue;
    const argv = [...base, '--kernel', e.kernel];
    if (e.cert) argv.push('--cert', `packages/${pkg}/cert/${e.cert}`);
    if (Array.isArray(e.specs)) for (const f of e.specs) argv.push('--spec', f);
    if (e.users) argv.push('--users', e.users);
    out.push({ label: `extra kernel ${e.kernel}: ${e.why}`, argv, env: e.env || {} });
  }
  return out;
}

function browser(pkg, manifestPath, tarball) {
  let runs;
  try {
    const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    runs = browserExtras(pkg, manifest, { tarball });
  } catch (err) {
    console.log(`::error::${err.message}`);
    return 1;
  }
  if (!runs.length) {
    console.log('browser-cert: no extra runs (the cert kernel checks the glue; no extra_kernels with specs)');
    return 0;
  }
  let failed = 0;
  for (const { label, argv, env } of runs) {
    console.log(`::group::browser-cert: ${label}`);
    const r = spawnSync(process.execPath, [join(root, 'scripts/gate.mjs'), 'cert-run', '--', process.execPath, ...argv], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    console.log('::endgroup::');
    if (r.status !== 0) {
      console.log(`::error::${pkg}: browser cert failed: ${label}`);
      failed = r.status || 1;
    }
  }
  return failed;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [mode, pkg] = process.argv.slice(2);
  const opt = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : '';
  };
  const manifest = opt('--manifest');
  if (!pkg || !['plan', 'ci', 'browser-extra'].includes(mode)) {
    console.error('usage: cert-leg.mjs plan <package> [--manifest <package.json>] | cert-leg.mjs ci <package> | cert-leg.mjs browser-extra <package> --manifest <package.json> [--tarball <package.tgz>]');
    process.exit(2);
  }
  const code = mode === 'browser-extra' ? browser(pkg, manifest, opt('--tarball') || '.homescoop-out/package.tgz') : mode === 'plan' ? plan(pkg, manifest) : ci(pkg);
  (mode === 'plan' ? console.error : console.log)(code === 0 ? `cert-leg: PASS ${mode} ${pkg}` : `cert-leg: FAIL ${mode} ${pkg}`);
  process.exit(code);
}
