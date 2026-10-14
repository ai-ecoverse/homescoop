#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandsOf } from './base-sweep/sweep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const KERNEL = '@ai-ecoverse/slicc-kernel';
const BIOS = 'ai-ecoverse/slicc-bios';
const HARNESS = ['@ai-ecoverse/slicc-shared-web@^1.4.1', 'playwright-core@1.63.0'];
const MAX_SHARDS = 6;
const SWEEP_MODES = ['report', 'enforce'];
const RUN_TIMEOUT_MS = 25 * 60 * 1000;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = 'true';
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(argv[i]);
  }
  return out;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const slug = (s) => s.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '_');

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

function must(cmd, args, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = sh(cmd, args, opts);
    if (r.status === 0) return r.stdout;
    if (attempt >= (opts.attempts || 1)) {
      throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stderr || ''}${r.stdout || ''}`);
    }
    sh('sleep', [String(5 * attempt)]);
  }
}

function output(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function digests(file) {
  const bytes = readFileSync(file);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

function npmView(spec) {
  const v = JSON.parse(must('npm', ['view', spec, '--json'], { attempts: 3 }));
  return Array.isArray(v) ? v[v.length - 1] : v;
}

function fetchTarball(name, version, integrity, dir) {
  mkdirSync(dir, { recursive: true });
  const packed = JSON.parse(
    must('npm', ['pack', `${name}@${version}`, '--pack-destination', dir, '--json'], { attempts: 3 }),
  );
  const file = join(dir, packed[0].filename);
  const d = digests(file);
  if (integrity && d.integrity !== integrity) {
    throw new Error(`${name}@${version}: tarball integrity ${d.integrity} is not the pinned ${integrity}`);
  }
  return { file, ...d };
}

function manifestOf(tgz) {
  return JSON.parse(must('tar', ['-xzOf', tgz, 'package/package.json']));
}

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v ?? '').trim());
  return m ? { main: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x.main[i] !== y.main[i]) return x.main[i] < y.main[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export function satisfies(version, range) {
  if (range === undefined || range === null || String(range).trim() === '*') return true;
  return String(range)
    .split('||')
    .some((alt) =>
      alt
        .trim()
        .split(/\s+/)
        .every((c) => {
          const m = /^(>=|<=|>|<|=)?(.+)$/.exec(c);
          const cmp = compareVersions(version, m[2]);
          if (Number.isNaN(cmp)) return false;
          if (m[1] === '>=') return cmp >= 0;
          if (m[1] === '<=') return cmp <= 0;
          if (m[1] === '>') return cmp > 0;
          if (m[1] === '<') return cmp < 0;
          return cmp === 0;
        }),
    );
}

function loadLimits() {
  const file = join(here, 'known-limits.json');
  return existsSync(file) ? readJson(file).limits || [] : [];
}

export function findLimit(limits, f) {
  return (
    limits.find((l) => {
      if (l.package !== f.package && l.package !== f.recipe) return false;
      if (l.spec !== f.spec) return false;
      if (!satisfies(f.kernel, l.kernel)) return false;
      if (l.version && !satisfies(f.version, l.version)) return false;
      if (l.users && !l.users.includes(f.users)) return false;
      if (l.user && l.user !== f.user) return false;
      if (l.rc !== undefined && l.rc !== f.rc) return false;
      if (l.spec === 'base-sweep') return l.case === f.case;
      return new RegExp(l.case, 'm').test(f.text || '');
    }) || null
  );
}

function recipes() {
  const out = [];
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    const pj = join(root, 'packages', dir, 'package', 'package.json');
    if (!existsSync(pj)) continue;
    const npm = readJson(pj).name;
    const certDir = join(root, 'packages', dir, 'cert');
    const specs = existsSync(certDir) ? readdirSync(certDir).filter((f) => f.endsWith('.mjs')).sort() : [];
    const meta = existsSync(join(certDir, 'meta.json')) ? readJson(join(certDir, 'meta.json')) : {};
    const harness = meta.harness || (specs.length ? 'slicc-kernel' : 'smoke');
    let skip = null;
    if (!specs.length) skip = 'no cert/*.mjs';
    else if (meta.blocked) skip = 'cert/meta.json is blocked';
    else if (harness !== 'slicc-kernel') skip = `harness ${harness} (not run.mjs)`;
    out.push({ dir, npm, specs, meta, skip });
  }
  return out;
}

async function github(path, accept) {
  const headers = { Accept: accept, 'User-Agent': 'homescoop-kernel-compat', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://api.github.com/${path}`, { headers });
    if (r.ok) return accept.endsWith('json') ? r.json() : r.text();
    if (attempt >= 3 || (r.status < 500 && r.status !== 429)) {
      throw new Error(`GET https://api.github.com/${path}: ${r.status} ${await r.text()}`);
    }
    await new Promise((done) => setTimeout(done, 3000 * attempt));
  }
}

async function biosPins(ref) {
  const sha = (await github(`repos/${BIOS}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github+json')).sha;
  const file = async (path) =>
    JSON.parse(await github(`repos/${BIOS}/contents/${path}?ref=${sha}`, 'application/vnd.github.raw'));
  const pins = async (dir) => {
    const pkg = await file(`${dir}/package.json`);
    const lock = await file(`${dir}/package-lock.json`);
    return Object.keys(pkg.dependencies || {})
      .sort()
      .map((name) => {
        const e = lock.packages?.[`node_modules/${name}`];
        if (!e?.version) throw new Error(`slicc-bios ${sha} ${dir}/package-lock.json has no ${name}`);
        return { name, version: e.version, integrity: e.integrity || null };
      });
  };
  return {
    sha,
    base: await pins('src/packages'),
    catalog: await pins('src/packages/optional'),
    files: ['src/packages/package.json', 'src/packages/package-lock.json', 'src/packages/optional/package.json', 'src/packages/optional/package-lock.json'],
  };
}

function kernelInfo(file, extra) {
  const m = manifestOf(file);
  return { name: m.name, version: m.version, gitHead: m.gitHead || null, ...digests(file), ...extra };
}

async function plan(args) {
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const kernelIn = (args.kernel || '').trim();
  const setIn = (args.set || 'base,ci-certified').trim();
  const biosRefIn = (args['bios-ref'] || 'main').trim();
  const homescoopRefIn = (args['homescoop-ref'] || '').trim();
  if (!kernelIn) throw new Error('--kernel is required');
  const homescoopSha = must('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  const bios = await biosPins(biosRefIn);
  console.log(`slicc-bios ${biosRefIn} = ${bios.sha}: base ${bios.base.length}, catalog ${bios.catalog.length}`);

  const tmp = join(out, 'tmp');
  let candidate;
  if (args['kernel-dir']) {
    const dir = resolve(args['kernel-dir']);
    const tgzs = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
    if (tgzs.length !== 1) throw new Error(`artifact ${kernelIn} must hold exactly one .tgz, found ${tgzs.join(', ') || 'none'}`);
    copyFileSync(join(dir, tgzs[0]), join(out, 'candidate.tgz'));
    candidate = kernelInfo(join(out, 'candidate.tgz'), { spec: `artifact:${kernelIn}`, source: 'artifact', file: tgzs[0] });
  } else {
    const spec = /^\d/.test(kernelIn) ? `${KERNEL}@${kernelIn}` : kernelIn;
    const view = npmView(spec);
    const t = fetchTarball(view.name, view.version, view.dist?.integrity, join(tmp, 'candidate'));
    renameSync(t.file, join(out, 'candidate.tgz'));
    candidate = kernelInfo(join(out, 'candidate.tgz'), { spec, source: 'npm', gitHead: view.gitHead || null });
  }
  if (candidate.name !== KERNEL) console.log(`::warning::candidate kernel is ${candidate.name}, not ${KERNEL}`);
  const pinned = bios.base.find((p) => p.name === KERNEL);
  if (!pinned) throw new Error(`slicc-bios ${bios.sha} pins no ${KERNEL}`);
  const refTgz = fetchTarball(KERNEL, pinned.version, pinned.integrity, join(tmp, 'reference'));
  renameSync(refTgz.file, join(out, 'reference.tgz'));
  const reference = kernelInfo(join(out, 'reference.tgz'), {
    spec: `${KERNEL}@${pinned.version}`,
    source: `slicc-bios ${bios.sha} src/packages/package-lock.json`,
    gitHead: npmView(`${KERNEL}@${pinned.version}`).gitHead || null,
  });

  const all = recipes();
  const byDir = new Map(all.map((r) => [r.dir, r]));
  const byNpm = new Map(all.map((r) => [r.npm, r]));
  const ciCertified = readJson(join(root, 'scripts/ci-certified.json')).packages;
  const entries = new Map();
  const skipped = new Map();
  const latest = new Map();
  const latestOf = (name) => {
    if (!latest.has(name)) {
      try {
        const v = npmView(`${name}@latest`);
        latest.set(name, { version: v.version, integrity: v.dist?.integrity || null });
      } catch (err) {
        latest.set(name, { error: String(err.message).split('\n')[0] });
      }
    }
    return latest.get(name);
  };
  const skip = (name, version, origin, reason) => {
    const key = `${name}@${version ?? '-'}`;
    const s = skipped.get(key) || { package: name, recipe: byNpm.get(name)?.dir ?? null, version: version ?? null, origin: [], reason };
    if (!s.origin.includes(origin)) s.origin.push(origin);
    skipped.set(key, s);
  };
  const add = (r, version, integrity, origin) => {
    if (r.skip) return skip(r.npm, version, origin, r.skip);
    const id = `${r.dir}@${version}`;
    const e =
      entries.get(id) ||
      {
        id,
        recipe: r.dir,
        package: r.npm,
        version,
        integrity,
        origin: [],
        users: r.meta.users || 'off',
        specs: r.specs,
      };
    if (!e.origin.includes(origin)) e.origin.push(origin);
    entries.set(id, e);
  };
  const addLatest = (r, origin) => {
    const l = latestOf(r.npm);
    if (l.error) return skip(r.npm, null, origin, `not on npm: ${l.error}`);
    add(r, l.version, l.integrity, origin);
  };
  const tokens = setIn.split(',').map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token === 'base' || token === 'catalog') {
      for (const p of bios[token]) {
        if (p.name === KERNEL) continue;
        const r = byNpm.get(p.name);
        if (!r) skip(p.name, p.version, token, 'no homescoop recipe');
        else add(r, p.version, p.integrity, token);
      }
    } else if (token === 'ci-certified') {
      for (const dir of ciCertified) addLatest(byDir.get(dir), token);
    } else if (token === 'all') {
      for (const r of all) if (r.specs.length) addLatest(r, token);
    } else {
      const m = /^(@[^@/]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(token);
      const r = m && (byDir.get(m[1]) || byNpm.get(m[1]) || byNpm.get(`@ai-ecoverse/${m[1]}`));
      if (!r) throw new Error(`set: ${token} is neither base, catalog, ci-certified, all nor a homescoop recipe`);
      if (m[2]) {
        const v = npmView(`${r.npm}@${m[2]}`);
        add(r, v.version, v.dist?.integrity || null, token);
      } else addLatest(r, token);
    }
  }

  let sweep = null;
  if (tokens.includes('base') || tokens.includes('all')) {
    const packages = [];
    const manifests = [];
    for (const p of bios.base) {
      if (p.name === KERNEL) continue;
      const t = fetchTarball(p.name, p.version, p.integrity, join(tmp, 'base'));
      packages.push({ name: p.name, version: p.version, integrity: t.integrity, sha256: t.sha256 });
      manifests.push(manifestOf(t.file));
    }
    sweep = { modes: SWEEP_MODES, packages, commands: commandsOf(manifests) };
    console.log(`base sweep: ${sweep.commands.length} cases from ${packages.length} base-set tarballs`);
  }
  rmSync(tmp, { recursive: true, force: true });

  const list = [...entries.values()];
  const weight = (e) => e.specs.length + 1;
  const n = Math.min(list.length, MAX_SHARDS);
  const bins = Array.from({ length: n }, () => ({ weight: 0, entries: [] }));
  list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => weight(b.e) - weight(a.e) || a.e.id.localeCompare(b.e.id))
    .forEach(({ e, i }) => {
      const bin = bins.reduce((lo, b) => (b.weight < lo.weight ? b : lo), bins[0]);
      bin.weight += weight(e);
      bin.entries.push(i);
    });
  const tag = createHash('sha256')
    .update(JSON.stringify([kernelIn, setIn, biosRefIn, homescoopRefIn || homescoopSha]))
    .digest('hex')
    .slice(0, 10);
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const doc = {
    version: 1,
    tag,
    createdAt: new Date().toISOString(),
    inputs: { kernel: kernelIn, set: setIn, biosRef: biosRefIn, homescoopRef: homescoopRefIn || 'HEAD' },
    homescoopRef: homescoopSha,
    biosRef: bios.sha,
    bios: { repository: BIOS, ref: biosRefIn, sha: bios.sha, files: bios.files },
    run: process.env.GITHUB_RUN_ID
      ? {
          repository: process.env.GITHUB_REPOSITORY,
          sha: process.env.GITHUB_SHA,
          event: process.env.GITHUB_EVENT_NAME,
          id: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT,
          url: `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        }
      : null,
    kernel: candidate,
    reference,
    entries: list,
    skipped: [...skipped.values()],
    shards: bins.map((b) => b.entries),
    sweep,
  };
  writeJson(join(out, 'plan.json'), doc);
  console.log(`candidate ${candidate.name}@${candidate.version} sha256 ${candidate.sha256}`);
  console.log(`reference ${reference.name}@${reference.version} sha256 ${reference.sha256} (slicc-bios ${bios.sha})`);
  for (const [k, b] of bins.entries()) {
    console.log(`shard ${k}: ${b.entries.map((i) => list[i].id).join(' ')}`);
  }
  for (const s of doc.skipped) console.log(`skip ${s.package}@${s.version ?? '-'} (${s.origin.join(',')}): ${s.reason}`);
  output('tag', tag);
  output('shards', JSON.stringify(bins.map((_, k) => k)));
  output('sweep', sweep ? 'true' : 'false');
  output('modes', JSON.stringify(sweep ? SWEEP_MODES : []));
  output('homescoop-sha', homescoopSha);
}

function installNeeds(recipe, nm, work) {
  const metaPath = join(root, 'packages', recipe, 'cert', 'meta.json');
  const meta = existsSync(metaPath) ? readJson(metaPath) : {};
  const npmInstall = (specs) =>
    must('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', ...specs], { attempts: 3, cwd: root });
  mkdirSync(nm, { recursive: true });
  npmInstall([...HARNESS, ...(meta.needsInstall || meta.needs || [])]);
  for (const script of meta.needsTarballScripts || []) {
    const tgz = must(process.execPath, [script], { cwd: root }).split('\n')[0].trim();
    console.log(`needsTarballScript ${script}: ${tgz}`);
    npmInstall([tgz]);
  }
  const repacked = [];
  for (const peer of meta.needsRepack || []) {
    const dir = join(work, 'repack', peer);
    must(process.execPath, [join(root, 'scripts/repack-published.mjs'), peer, '--out', dir], { cwd: root });
    console.log(`needsRepack ${peer} sha256 ${readFileSync(join(dir, 'package.tgz.sha256'), 'utf8').split(' ')[0]}`);
    repacked.push(join(dir, 'package.tgz'));
  }
  if (repacked.length) npmInstall(repacked);
  const lock = existsSync(join(nm, 'package-lock.json')) ? readJson(join(nm, 'package-lock.json')) : { packages: {} };
  return (meta.needs || []).map((name) => {
    const e = lock.packages?.[`node_modules/${name}`] || {};
    return { name, version: e.version || null, integrity: e.integrity || null };
  });
}

function certRun({ label, kernelFile, recipe, cert, tarballs, users, work, logs, logName, env = {} }) {
  const json = join(work, `${label}.json`);
  rmSync(json, { force: true });
  const log = join(logs, `${logName}.${label}.log`);
  const args = [join(here, 'run.mjs'), '--package', recipe, ...(cert ? ['--cert', cert] : [])];
  for (const t of tarballs) args.push('--tarball', t);
  args.push('--kernel', kernelFile, '--users', users, '--json', json);
  const started = Date.now();
  const r = sh(process.execPath, args, {
    cwd: root,
    env: { ...process.env, HOMESCOOP_CERT_NODE_MODULES: join(work, 'nm', 'node_modules'), ...env },
    timeout: RUN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const durationMs = Date.now() - started;
  const text = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}${r.error ? `\n${r.error}` : ''}`;
  writeFileSync(log, text);
  console.log(`::group::${logName} ${label}: exit ${r.status ?? r.signal} in ${Math.round(durationMs / 1000)} s`);
  console.log(text.length > 60000 ? `${text.slice(0, 20000)}\n…\n${text.slice(-40000)}` : text);
  console.log('::endgroup::');
  const rep = existsSync(json)
    ? readJson(json)
    : { status: 'fail', specs: [], error: r.error ? String(r.error) : `run.mjs exited ${r.status ?? r.signal} without a report` };
  if (r.status !== 0 && rep.status === 'pass') rep.status = 'fail';
  return { ...rep, exit: r.status, durationMs, log: relative(dirname(logs), log) };
}

function failingSpecs(rep) {
  const failed = rep.specs.filter((s) => s.status === 'fail').map((s) => ({ spec: s.spec, text: s.error || '' }));
  if (!rep.specs.length && rep.status === 'fail') failed.push({ spec: '(boot)', text: rep.error || '' });
  if (rep.pageErrors?.length) failed.push({ spec: '(page errors)', text: rep.pageErrors.join('\n') });
  return failed;
}

function mergeAttempts(a, b) {
  if (!b) return a;
  const specs = [...new Set([...a.specs, ...b.specs].map((s) => s.spec))].map((spec) => {
    const x = a.specs.find((s) => s.spec === spec);
    const y = b.specs.find((s) => s.spec === spec);
    const passed = [x, y].filter((s) => s?.status === 'pass');
    if (passed.length) return { ...passed[0], flaky: passed.length === 1 && Boolean(x && y) };
    return y || x;
  });
  const status = specs.length && specs.every((s) => s.status === 'pass') && !b.pageErrors?.length ? 'pass' : 'fail';
  return { ...b, specs, status, error: specs.length ? null : b.error || a.error, attempts: [a.log, b.log], durationMs: a.durationMs + b.durationMs };
}

function shard(args) {
  const planFile = resolve(args.plan);
  const plan = readJson(planFile);
  const kdir = dirname(planFile);
  const index = Number(args.index);
  const out = resolve(args.out);
  const logs = join(out, 'logs');
  mkdirSync(logs, { recursive: true });
  const limits = loadLimits();
  const candidateFile = join(kdir, 'candidate.tgz');
  const referenceFile = join(kdir, 'reference.tgz');
  const sameKernel = plan.kernel.sha256 === plan.reference.sha256;
  const startedAt = new Date();
  const results = [];
  for (const i of plan.shards[index] || []) {
    const e = plan.entries[i];
    const work = join(out, 'work', slug(e.id));
    const started = Date.now();
    const result = { ...e, status: 'fail', verdict: 'error', specs: [], reference: null, peers: [], durationMs: 0 };
    try {
      const tgz = fetchTarball(e.package, e.version, e.integrity, join(work, 'tgz'));
      result.sha256 = tgz.sha256;
      result.integrity = tgz.integrity;
      result.peers = installNeeds(e.recipe, join(work, 'nm'), work);
      const base = { recipe: e.recipe, tarballs: [tgz.file], users: e.users, work, logs, logName: slug(e.id) };
      let cand = certRun({ ...base, label: 'candidate', kernelFile: candidateFile });
      if (cand.status !== 'pass') cand = mergeAttempts(cand, certRun({ ...base, label: 'candidate-retry', kernelFile: candidateFile }));
      result.status = cand.status;
      result.log = cand.log;
      result.attempts = cand.attempts || [cand.log];
      result.kernelSeen = cand.kernel;
      const failed = failingSpecs(cand);
      const facts = (f) => ({
        package: e.package,
        recipe: e.recipe,
        spec: f.spec,
        version: e.version,
        kernel: plan.kernel.version,
        users: e.users,
        text: f.text,
      });
      const open = [];
      const verdicts = new Map();
      for (const f of failed) {
        const limit = findLimit(limits, facts(f));
        if (limit) verdicts.set(f.spec, { verdict: 'known', limit });
        else open.push(f);
      }
      if (open.length) {
        if (sameKernel) {
          for (const f of open) verdicts.set(f.spec, { verdict: 'known', why: 'fails on the reference kernel (the candidate is the reference)' });
        } else {
          let ref = certRun({ ...base, label: 'reference', kernelFile: referenceFile });
          if (ref.status !== 'pass') ref = mergeAttempts(ref, certRun({ ...base, label: 'reference-retry', kernelFile: referenceFile }));
          result.reference = { status: ref.status, log: ref.log, attempts: ref.attempts || [ref.log], specs: ref.specs, error: ref.error };
          for (const f of open) {
            const booted = ref.specs.length > 0;
            const refPassed =
              f.spec === '(boot)'
                ? booted
                : f.spec === '(page errors)'
                  ? booted && !ref.pageErrors?.length
                  : ref.specs.find((s) => s.spec === f.spec)?.status === 'pass';
            verdicts.set(f.spec, refPassed ? { verdict: 'regression' } : { verdict: 'known', why: 'fails on the reference kernel too' });
          }
        }
      }
      result.specs = [
        ...cand.specs.map((s) => ({ ...s, ...(s.status === 'pass' ? { verdict: 'pass' } : verdicts.get(s.spec) || { verdict: 'regression' }) })),
        ...failed
          .filter((f) => f.spec.startsWith('('))
          .map((f) => ({ spec: f.spec, status: 'fail', error: f.text, ...verdicts.get(f.spec) })),
      ];
      const vs = result.specs.map((s) => s.verdict);
      result.verdict = vs.includes('regression') ? 'regression' : vs.includes('known') ? 'known' : 'pass';
    } catch (err) {
      result.error = String(err.stack || err).slice(0, 8000);
      console.log(`::error::${e.id}: ${String(err.message).split('\n')[0]}`);
    }
    result.durationMs = Date.now() - started;
    console.log(`${e.id}: ${result.status} → ${result.verdict} in ${Math.round(result.durationMs / 1000)} s`);
    results.push(result);
    rmSync(work, { recursive: true, force: true });
  }
  const finishedAt = new Date();
  writeJson(join(out, `shard-${index}.json`), {
    shard: index,
    runner: process.env.RUNNER_NAME || null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    wallMs: finishedAt - startedAt,
    results,
  });
}

function sweep(args) {
  const planFile = resolve(args.plan);
  const plan = readJson(planFile);
  const kdir = dirname(planFile);
  const mode = args.mode;
  if (!SWEEP_MODES.includes(mode)) throw new Error(`--mode must be one of ${SWEEP_MODES.join(', ')}`);
  const out = resolve(args.out);
  const logs = join(out, 'logs');
  mkdirSync(logs, { recursive: true });
  const limits = loadLimits();
  const work = join(out, 'work', `sweep-${mode}`);
  const startedAt = new Date();
  const doc = { mode, runner: process.env.RUNNER_NAME || null, startedAt: startedAt.toISOString(), rows: [], error: null, runs: [] };
  try {
    const tarballs = plan.sweep.packages.map((p) => fetchTarball(p.name, p.version, p.integrity, join(work, 'tgz')).file);
    mkdirSync(join(work, 'nm'), { recursive: true });
    must('npm', ['install', '--prefix', join(work, 'nm'), '--no-fund', '--no-audit', ...HARNESS], { attempts: 3, cwd: root });
    const byNpm = new Map(recipes().map((r) => [r.npm, r.dir]));
    const pass = (label, kernelFile, only) => {
      const rowsFile = join(work, `${label}.rows.json`);
      rmSync(rowsFile, { force: true });
      const rep = certRun({
        label,
        kernelFile,
        recipe: 'base-sweep',
        cert: join(here, 'base-sweep'),
        tarballs,
        users: mode,
        work,
        logs,
        logName: `base-sweep-${mode}`,
        env: { HOMESCOOP_SWEEP_OUT: rowsFile, ...(only ? { HOMESCOOP_SWEEP_ONLY: JSON.stringify(only) } : {}) },
      });
      doc.runs.push({ label, status: rep.status, durationMs: rep.durationMs, log: rep.log, error: rep.error || null });
      return existsSync(rowsFile) ? readJson(rowsFile).rows : null;
    };
    const key = (r) => `${r.user} ${r.command}`;
    let rows = pass('candidate', join(kdir, 'candidate.tgz'));
    if (!rows) {
      rows = [{ user: '-', command: '(boot)', package: null, status: 'fail', rc: null, expected: 0, out: doc.runs[0].error }];
    }
    const failedCmds = () => [...new Set(rows.filter((r) => r.status === 'fail' && r.command !== '(boot)').map((r) => r.command))];
    if (failedCmds().length) {
      const again = pass('candidate-retry', join(kdir, 'candidate.tgz'), failedCmds());
      if (again) {
        const passedAgain = new Set(again.filter((r) => r.status === 'pass').map(key));
        rows = rows.map((r) => (passedAgain.has(key(r)) ? { ...r, status: 'pass', flaky: true } : r));
      }
    }
    const facts = (r) => ({
      package: r.package,
      recipe: byNpm.get(r.package) || null,
      spec: 'base-sweep',
      case: r.command,
      version: r.version,
      kernel: plan.kernel.version,
      users: mode,
      user: r.user,
      rc: r.rc,
    });
    const open = [];
    for (const r of rows) {
      r.recipe = byNpm.get(r.package) || null;
      if (r.status !== 'fail') {
        r.verdict = r.status;
        continue;
      }
      const limit = findLimit(limits, facts(r));
      if (limit) Object.assign(r, { verdict: 'known', limit });
      else open.push(r);
    }
    if (open.length) {
      if (plan.kernel.sha256 === plan.reference.sha256) {
        for (const r of open) Object.assign(r, { verdict: 'known', why: 'the candidate is the reference kernel' });
      } else {
        const boot = open.some((r) => r.command === '(boot)');
        const ref = pass('reference', join(kdir, 'reference.tgz'), boot ? null : [...new Set(open.map((r) => r.command))]);
        const refRows = new Map((ref || []).map((r) => [key(r), r]));
        for (const r of open) {
          if (r.command === '(boot)') {
            Object.assign(r, ref ? { verdict: 'regression' } : { verdict: 'known', why: 'the reference kernel fails to boot the sweep too' });
            continue;
          }
          const rr = refRows.get(key(r));
          r.reference = rr ? { rc: rr.rc, status: rr.status, out: rr.out } : null;
          Object.assign(r, rr?.status === 'pass' ? { verdict: 'regression' } : { verdict: 'known', why: 'fails on the reference kernel too' });
        }
      }
    }
    doc.rows = rows;
  } catch (err) {
    doc.error = String(err.stack || err).slice(0, 8000);
    console.log(`::error::base sweep ${mode}: ${String(err.message).split('\n')[0]}`);
  }
  const finishedAt = new Date();
  doc.finishedAt = finishedAt.toISOString();
  doc.wallMs = finishedAt - startedAt;
  rmSync(work, { recursive: true, force: true });
  const counts = {};
  for (const r of doc.rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  console.log(`base sweep ${mode}: ${JSON.stringify(counts)} in ${Math.round(doc.wallMs / 1000)} s`);
  writeJson(join(out, `sweep-${mode}.json`), doc);
}

function findFiles(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? findFiles(join(dir, d.name), re) : re.test(d.name) ? [join(dir, d.name)] : [],
  );
}

const ICON = { pass: '✅', known: '🟡', regression: '❌', skip: '⏭️', error: '💥' };
const secs = (ms) => (ms === undefined || ms === null ? '' : `${Math.round(ms / 1000)} s`);
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function report(args) {
  const plan = readJson(resolve(args.plan));
  const resultsDir = resolve(args.results);
  const out = resolve(args.out);
  mkdirSync(join(out, 'logs'), { recursive: true });
  const failOnRegression = args['fail-on-regression'] !== 'false';
  const shardDocs = new Map(findFiles(resultsDir, /^shard-\d+\.json$/).map((f) => [readJson(f).shard, { ...readJson(f), file: f }]));
  const sweepDocs = new Map(findFiles(resultsDir, /^sweep-[a-z]+\.json$/).map((f) => [readJson(f).mode, readJson(f)]));
  for (const log of findFiles(resultsDir, /\.log$/)) copyFileSync(log, join(out, 'logs', log.split('/').pop()));

  const results = [];
  const packages = [];
  const errors = [];
  const shards = [];
  plan.shards.forEach((idx, k) => {
    const doc = shardDocs.get(k);
    shards.push({ shard: k, packages: idx.map((i) => plan.entries[i].id), wallMs: doc?.wallMs ?? null, runner: doc?.runner ?? null, reported: Boolean(doc) });
    for (const i of idx) {
      const e = plan.entries[i];
      const r = doc?.results.find((x) => x.id === e.id);
      if (!r) {
        errors.push(`${e.id}: shard ${k} reported nothing`);
        packages.push({ ...e, status: 'fail', verdict: 'error', error: `shard ${k} reported nothing` });
        results.push({ package: e.package, recipe: e.recipe, version: e.version, sha256: null, spec: null, users: e.users, status: 'fail', verdict: 'error', durationMs: null, log: null });
        continue;
      }
      if (r.verdict === 'error') errors.push(`${e.id}: ${String(r.error || 'error').split('\n')[0]}`);
      packages.push({ id: r.id, package: r.package, recipe: r.recipe, version: r.version, sha256: r.sha256 ?? null, origin: r.origin, users: r.users, status: r.status, verdict: r.verdict, durationMs: r.durationMs, peers: r.peers, reference: r.reference ? { status: r.reference.status, log: r.reference.log } : null, error: r.error || null });
      const specs = r.specs.length ? r.specs : [{ spec: null, status: r.status, verdict: r.verdict, error: r.error }];
      for (const s of specs) {
        const rs = r.reference?.specs?.find((x) => x.spec === s.spec);
        results.push({
          package: r.package,
          recipe: r.recipe,
          version: r.version,
          sha256: r.sha256 ?? null,
          spec: s.spec,
          users: r.users,
          status: s.status,
          verdict: s.verdict,
          durationMs: s.durationMs ?? null,
          log: r.log ? `logs/${r.log.split('/').pop()}` : null,
          ...(s.flaky ? { flaky: true } : {}),
          ...(s.error && s.status !== 'pass' ? { error: s.error.slice(0, 2000) } : {}),
          ...(s.limit ? { limit: { issue: s.limit.issue, why: s.limit.why, kernel: s.limit.kernel } } : {}),
          ...(s.why ? { why: s.why } : {}),
          ...(r.reference ? { reference: { status: rs?.status ?? r.reference.status, log: `logs/${r.reference.log.split('/').pop()}` } } : {}),
        });
      }
    }
  });
  for (const s of plan.skipped) {
    results.push({ package: s.package, recipe: s.recipe, version: s.version, sha256: null, spec: null, users: null, status: 'skip', verdict: 'skip', durationMs: null, log: null, why: s.reason });
  }
  const sweepOut = [];
  const sweeps = [];
  if (plan.sweep) {
    for (const mode of plan.sweep.modes) {
      const doc = sweepDocs.get(mode);
      sweeps.push({ mode, wallMs: doc?.wallMs ?? null, runner: doc?.runner ?? null, reported: Boolean(doc), runs: doc?.runs || [] });
      if (!doc) {
        errors.push(`base sweep ${mode}: reported nothing`);
        continue;
      }
      if (doc.error) errors.push(`base sweep ${mode}: ${doc.error.split('\n')[0]}`);
      for (const r of doc.rows) sweepOut.push({ users: mode, ...r });
    }
  }
  const count = (rows, v) => rows.filter((r) => r.verdict === v).length;
  const regressions = count(results, 'regression') + count(sweepOut, 'regression');
  const summary = {
    pass: count(results, 'pass'),
    known: count(results, 'known'),
    regression: count(results, 'regression'),
    skip: count(results, 'skip'),
    error: errors.length,
    sweep: { pass: count(sweepOut, 'pass'), known: count(sweepOut, 'known'), regression: count(sweepOut, 'regression'), skip: count(sweepOut, 'skip') },
    regressions,
  };
  const verdict = errors.length ? 'error' : regressions ? 'regression' : 'pass';
  const compat = {
    kernel: { spec: plan.kernel.spec, name: plan.kernel.name, version: plan.kernel.version, sha256: plan.kernel.sha256, integrity: plan.kernel.integrity, gitHead: plan.kernel.gitHead, source: plan.kernel.source },
    reference: { spec: plan.reference.spec, version: plan.reference.version, sha256: plan.reference.sha256, gitHead: plan.reference.gitHead, source: plan.reference.source },
    homescoopRef: plan.homescoopRef,
    biosRef: plan.biosRef,
    inputs: plan.inputs,
    run: plan.run,
    verdict,
    summary,
    errors,
    results,
    packages,
    sweep: sweepOut,
    shards,
    sweeps,
  };
  writeJson(join(out, 'compat.json'), compat);

  const k = plan.kernel;
  const md = [];
  md.push(`## kernel-compat: ${k.name}@${k.version} ${ICON[verdict === 'regression' ? 'regression' : verdict]} ${verdict}`);
  md.push('');
  md.push(`- candidate: \`${k.spec}\` → ${k.name}@${k.version}, sha256 \`${k.sha256}\`${k.gitHead ? `, gitHead \`${k.gitHead}\`` : ''}`);
  md.push(`- reference (pinned by slicc-bios \`${plan.inputs.biosRef}\` = \`${plan.biosRef}\`): ${plan.reference.version}, sha256 \`${plan.reference.sha256}\``);
  md.push(`- homescoop \`${plan.homescoopRef}\`, set \`${plan.inputs.set}\``);
  md.push(`- specs: ${summary.pass} pass, ${summary.known} known, ${summary.regression} regression, ${summary.skip} skipped; base sweep: ${summary.sweep.pass} pass, ${summary.sweep.known} known, ${summary.sweep.regression} regression${errors.length ? `; **${errors.length} errors**` : ''}`);
  md.push('');
  if (errors.length) {
    md.push('### Errors');
    md.push('');
    for (const e of errors) md.push(`- ${cell(e)}`);
    md.push('');
  }
  md.push('### Packages');
  md.push('');
  md.push('| | Package | Version | Users | Candidate | Reference | Time | Notes |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of packages) {
    const specRows = results.filter((r) => r.recipe === p.recipe && r.version === p.version);
    const notes = specRows
      .filter((r) => r.verdict !== 'pass')
      .map((r) => `${r.spec}: ${r.verdict}${r.limit ? ` (${r.limit.issue})` : r.why ? ` (${r.why})` : ''}`)
      .concat(specRows.filter((r) => r.flaky).map((r) => `${r.spec}: flaky`))
      .join('; ');
    md.push(`| ${ICON[p.verdict] || ''} | ${p.recipe} | ${p.version} | ${p.users} | ${p.status} | ${p.reference?.status ?? ''} | ${secs(p.durationMs)} | ${cell(notes || p.error || '')} |`);
  }
  if (plan.skipped.length) {
    md.push('');
    md.push(`Skipped: ${plan.skipped.map((s) => `${s.package.replace('@ai-ecoverse/', '')} (${s.reason})`).join(', ')}`);
  }
  if (plan.sweep) {
    md.push('');
    md.push('### Base-set sweep');
    md.push('');
    md.push('| Users | User | Cases | Pass | Known | Regression | Wall time |');
    md.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const s of sweeps) {
      for (const user of ['root', 'cone']) {
        const rows = sweepOut.filter((r) => r.users === s.mode && r.user === user);
        md.push(`| ${s.mode} | ${user} | ${rows.length} | ${count(rows, 'pass')} | ${count(rows, 'known')} | ${count(rows, 'regression')} | ${secs(s.wallMs)} |`);
      }
    }
    const odd = sweepOut.filter((r) => r.verdict !== 'pass');
    if (odd.length) {
      md.push('');
      md.push('| | Users | User | Command | Package | rc | Reference rc | Notes |');
      md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const r of odd) {
        md.push(`| ${ICON[r.verdict] || ''} | ${r.users} | ${r.user} | \`${cell(r.command)}\` | ${cell(r.recipe || r.package)} | ${r.rc ?? ''} | ${r.reference?.rc ?? ''} | ${cell(r.limit ? `${r.limit.issue}: ${r.limit.why}` : r.why || r.out || '').slice(0, 160)} |`);
      }
    }
  }
  md.push('');
  md.push('### Shards');
  md.push('');
  md.push('| Job | Packages | Wall time | Runner |');
  md.push('| --- | --- | --- | --- |');
  for (const s of shards) md.push(`| shard ${s.shard} | ${s.packages.join(' ')} | ${s.reported ? secs(s.wallMs) : 'no report'} | ${s.runner || ''} |`);
  for (const s of sweeps) md.push(`| base-sweep ${s.mode} | ${plan.sweep.packages.length} tarballs, ${plan.sweep.commands.length} cases × 2 users | ${s.reported ? secs(s.wallMs) : 'no report'} | ${s.runner || ''} |`);
  const text = `${md.join('\n')}\n`;
  writeFileSync(join(out, 'summary.md'), text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
  output('verdict', verdict);
  output('regressions', String(regressions));
  if (errors.length) {
    console.log(`::error::kernel-compat could not answer for ${errors.length} item(s): ${errors.join('; ').slice(0, 1000)}`);
    process.exit(1);
  }
  if (regressions) {
    const names = [...new Set([...results, ...sweepOut].filter((r) => r.verdict === 'regression').map((r) => r.recipe || r.package))];
    const msg = `${regressions} regression(s) on ${k.name}@${k.version} against ${plan.reference.version}: ${names.join(', ')}`;
    console.log(failOnRegression ? `::error::${msg}` : `::warning::${msg}`);
    if (failOnRegression) process.exit(1);
  }
}

function verify(args) {
  const positive = readJson(resolve(args.positive));
  const negative = readJson(resolve(args.negative));
  const expected = (args['expect-regressions'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const problems = [];
  const md = ['## kernel-compat proof', ''];
  md.push(`- positive: ${positive.kernel.name}@${positive.kernel.version} vs ${positive.reference.version}: **${positive.verdict}** (${positive.summary.regressions} regressions, ${positive.summary.error} errors)`);
  if (positive.verdict !== 'pass') problems.push(`positive run is ${positive.verdict}, not pass`);
  const regs = [...negative.results, ...negative.sweep].filter((r) => r.verdict === 'regression');
  const byRecipe = new Map();
  for (const r of regs) {
    const name = r.recipe || r.package;
    const e = byRecipe.get(name) || { specs: [], sweep: [] };
    if (r.command) e.sweep.push(`${r.users}/${r.user} ${r.command} rc=${r.rc}`);
    else e.specs.push(r.spec);
    byRecipe.set(name, e);
  }
  md.push(`- negative: ${negative.kernel.name}@${negative.kernel.version} vs ${negative.reference.version}: **${negative.verdict}** (${negative.summary.regressions} regressions, ${negative.summary.error} errors)`);
  if (negative.summary.error) problems.push(`negative run has ${negative.summary.error} errors`);
  md.push('');
  md.push('| Package | Expected | Spec regressions | Sweep regressions |');
  md.push('| --- | --- | --- | --- |');
  for (const name of [...new Set([...expected, ...byRecipe.keys()])].sort()) {
    const e = byRecipe.get(name) || { specs: [], sweep: [] };
    const want = expected.includes(name);
    if (want && !e.specs.length) problems.push(`${name}: no spec regression on ${negative.kernel.version}`);
    if (want && !e.sweep.length) problems.push(`${name}: no base-sweep regression on ${negative.kernel.version}`);
    md.push(`| ${name} | ${want ? 'yes' : 'no'} | ${cell(e.specs.join(', '))} | ${cell(e.sweep.slice(0, 6).join(', '))}${e.sweep.length > 6 ? ` (+${e.sweep.length - 6})` : ''} |`);
  }
  md.push('');
  md.push(problems.length ? `**Proof failed:**\n\n${problems.map((p) => `- ${p}`).join('\n')}` : '**Proof holds:** the positive run is green and every expected package regresses on the negative kernel.');
  const text = `${md.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
  if (problems.length) process.exit(1);
}

const commands = { plan, shard, sweep, report, verify };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const fn = commands[args._[0]];
  if (!fn) {
    console.error(`usage: compat.mjs ${Object.keys(commands).join('|')} [--flags]`);
    process.exit(2);
  }
  try {
    await fn(args);
  } catch (err) {
    console.error(err.stack || err);
    process.exit(1);
  }
}
