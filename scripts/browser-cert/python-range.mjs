#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, inPythonRange, pythonRange } from '../check-exact-pins.mjs';
import { readCertMeta } from './cert-meta.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOP = `node_modules/${PYTHON}`;

export function lockErrors(lock, python) {
  const errors = [];
  const pkgs = lock?.packages || {};
  const top = pkgs[TOP]?.version;
  if (top !== python) errors.push(`${TOP} is ${top ?? 'missing'}, not ${python}`);
  for (const [path, entry] of Object.entries(pkgs)) {
    if (path !== TOP && path.endsWith(`/${TOP}`)) errors.push(`a second python: ${path} ${entry.version}`);
  }
  return errors;
}

export function newestFrom(meta) {
  const pin = (meta.needsInstall || []).find((n) => typeof n === 'string' && n.startsWith(`${PYTHON}@`));
  return pin ? pin.slice(PYTHON.length + 1) : null;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: exit ${r.status ?? r.signal}\n${r.stderr || ''}${r.stdout || ''}`);
  return r.stdout;
}

function lockFor(tgz, python, work) {
  const dir = mkdtempSync(join(work, 'lock-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"python-range-probe","private":true}\n');
  sh('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--silent', tgz, `${PYTHON}@${python}`], { cwd: dir });
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  return lock;
}

function nestedIn(nm) {
  const scope = join(nm, '@ai-ecoverse');
  if (!existsSync(scope)) return [];
  return readdirSync(scope)
    .map((p) => join(scope, p, 'node_modules', PYTHON, 'package.json'))
    .filter((f) => existsSync(f))
    .map((f) => `${f.slice(nm.length + 1, -'/package.json'.length)} ${JSON.parse(readFileSync(f, 'utf8')).version}`);
}

function main(argv) {
  const ti = argv.indexOf('--tarball');
  const pkg = argv.find((a, i) => !a.startsWith("--") && (ti < 0 || i !== ti + 1));
  const tgz = resolve(root, ti >= 0 ? argv[ti + 1] : '.homescoop-out/package.tgz');
  if (!pkg || !existsSync(tgz)) {
    console.error('usage: python-range.mjs <py-pkg> [--tarball <package.tgz>] [--lock-only] [--keep]');
    return 2;
  }
  const repoPj = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package/package.json'), 'utf8'));
  const spec = repoPj.dependencies?.[PYTHON];
  const range = pythonRange(spec);
  if (!range) {
    console.error(`::error::packages/${pkg}/package/package.json: ${PYTHON} is ${JSON.stringify(spec)}, not a >=X.Y.Z-N <X.Y.Z+1 range (homescoop#702)`);
    return 1;
  }
  const meta = readCertMeta(join(root, 'packages', pkg, 'cert/meta.json'), `packages/${pkg}/cert/meta.json`);
  const newest = newestFrom(meta);
  if (!newest || !inPythonRange(newest, spec)) {
    console.error(`::error::packages/${pkg}/cert/meta.json: needsInstall has ${newest ? `${PYTHON}@${newest}, outside ${spec}` : `no ${PYTHON}@<version>`}`);
    return 1;
  }
  const listed = JSON.parse(sh('npm', ['view', `${PYTHON}@${spec}`, 'version', '--json']));
  const registry = [].concat(listed).pop();
  console.log(`python-range: ${repoPj.name} takes ${PYTHON} ${spec}; floor ${range.floor}, newest ${newest} (cert/meta.json), newest on npm ${registry}`);
  if (registry !== newest) console.log(`::warning::${pkg}: npm has ${PYTHON}@${registry} in ${spec}; this cert's newest is ${newest}`);

  const base = process.env.RUNNER_TEMP || tmpdir();
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, `python-range-${pkg}-`));
  let failed = 0;
  try {
    for (const python of [...new Set([range.floor, newest])]) {
      const errors = lockErrors(lockFor(tgz, python, work), python);
      if (errors.length) {
        failed++;
        console.error(`python-range: FAIL ${tgz} with ${PYTHON}@${python}:\n  - ${errors.join('\n  - ')}`);
      } else {
        console.log(`python-range: ok, ${tgz} with ${PYTHON}@${python} resolves one python, ${TOP} ${python}`);
      }
    }
    if (failed || argv.includes('--lock-only')) return failed ? 1 : 0;

    const prefix = join(work, 'floor');
    console.log(`::group::python-range: cert harness for ${pkg} (scripts/cert-review/harness.sh)`);
    const h = spawnSync('bash', ['scripts/cert-review/harness.sh', pkg, prefix], { cwd: root, stdio: 'inherit' });
    console.log('::endgroup::');
    if (h.status !== 0) {
      console.error(`::error::${pkg}: the cert harness didn't install (${h.status ?? h.signal})`);
      return 1;
    }
    sh('npm', ['install', '--prefix', prefix, '--no-fund', '--no-audit', '--silent', `${PYTHON}@${range.floor}`]);
    const nm = join(prefix, 'node_modules');
    const got = JSON.parse(readFileSync(join(nm, PYTHON, 'package.json'), 'utf8')).version;
    const nested = nestedIn(nm).filter((n) => !n.endsWith(` ${range.floor}`));
    if (got !== range.floor || nested.length) {
      console.error(`::error::${pkg}: the floor harness has ${PYTHON} ${got}${nested.length ? ` and nested ${nested.join(', ')}` : ''}; every py-* must resolve to ${range.floor}`);
      return 1;
    }
    console.log(`python-range: ${pkg}'s specs on the floor python, ${PYTHON}@${range.floor}`);
    const r = spawnSync('node', ['scripts/browser-cert/run.mjs', '--package', pkg, '--tarball', tgz], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, HOMESCOOP_CERT_NODE_MODULES: nm },
    });
    if (r.status !== 0) {
      console.error(`::error::${pkg}: the specs fail on ${PYTHON}@${range.floor} (${r.status ?? r.signal})`);
      return r.status || 1;
    }
    console.log(`python-range: ok, ${pkg}'s specs pass on ${PYTHON}@${range.floor} and (ladder-pr's browser cert) ${newest}`);
    return 0;
  } finally {
    if (!argv.includes('--keep')) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
