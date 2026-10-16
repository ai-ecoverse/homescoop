#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCertMeta } from './cert-meta.mjs';

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
  return meta;
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
  return { browser, ci, harness, specs: specs.length, error, nothing };
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
  const cmds = meta.ci || [];
  if (!cmds.length) {
    console.log('host cert: no ci commands');
    return 0;
  }
  for (const cmd of cmds) {
    console.log(`::group::host cert: ${cmd}`);
    const r = spawnSync('bash', ['-c', cmd], { cwd: root, stdio: 'inherit' });
    console.log('::endgroup::');
    if (r.status !== 0) {
      console.log(`::error::${pkg}: host cert command failed (${r.status ?? r.signal}): ${cmd}`);
      return r.status || 1;
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [mode, pkg] = process.argv.slice(2);
  const i = process.argv.indexOf('--manifest');
  const manifest = i > 0 ? process.argv[i + 1] : '';
  if (!pkg || !['plan', 'ci'].includes(mode)) {
    console.error('usage: cert-leg.mjs plan <package> [--manifest <package.json>] | cert-leg.mjs ci <package>');
    process.exit(2);
  }
  process.exit(mode === 'plan' ? plan(pkg, manifest) : ci(pkg));
}
