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
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandsOf } from './base-sweep/sweep.mjs';
import { devPin } from '../dev-pin.mjs';
import { pickRecipe, recipeOf } from '../npm-tag.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const KERNEL = '@ai-ecoverse/slicc-kernel';
const BIOS = 'ai-ecoverse/slicc-bios';
const HARNESS = ['@ai-ecoverse/slicc-shared-web', 'monocart-coverage-reports', 'playwright-core'].map((name) => devPin(name));
const MAX_SHARDS = 10;
const ESTIMATE = { entry: 10, spec: 4, sweep: 150, shard: 900, limit: 1200 };
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

function loadTimings() {
  const file = join(here, 'timings.json');
  const doc = existsSync(file) ? readJson(file) : {};
  return { seconds: doc.seconds || {}, versions: doc.versions || {} };
}

export function costOf(v, specs) {
  const failing = specs.some((sp) => (v.runs[sp] || 1) > 1);
  const runs = failing ? Math.max(...specs.map((sp) => v.runs[sp] || 1)) : 1;
  return Math.ceil(v.setup * runs + specs.reduce((sum, sp) => sum + (v.specs[sp] ?? ESTIMATE.spec) * (v.runs[sp] || 1), 0));
}

export function splitEntry(v, specs, target, limit = target) {
  const whole = costOf(v, specs);
  if (whole <= limit || specs.length < 2) return [{ specs: null, seconds: whole }];
  const k = Math.min(specs.length, Math.ceil(whole / target));
  const parts = Array.from({ length: k }, () => []);
  for (const sp of [...specs].sort((a, b) => costOf(v, [b]) - costOf(v, [a]) || a.localeCompare(b))) {
    parts.reduce((lo, part) => (costOf(v, part) < costOf(v, lo) ? part : lo), parts[0]).push(sp);
  }
  return parts.filter((part) => part.length).map((part) => ({ specs: part.sort(), seconds: costOf(v, part) }));
}

export function pack(units, n) {
  const bins = Array.from({ length: n }, () => ({ seconds: 0, units: [] }));
  for (const u of [...units].sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id))) {
    const bin = bins.reduce((lo, b) => (b.seconds < lo.seconds ? b : lo), bins[0]);
    bin.seconds += u.seconds;
    bin.units.push(u);
  }
  return bins;
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
    const { tag, version, upstream, retired } = existsSync(join(root, 'packages', dir, 'recipe.yaml')) ? recipeOf(dir, root) : { tag: 'latest', version: readJson(pj).version, upstream: null, retired: false };
    const certDir = join(root, 'packages', dir, 'cert');
    const specs = existsSync(certDir) ? readdirSync(certDir).filter((f) => f.endsWith('.mjs')).sort() : [];
    const meta = existsSync(join(certDir, 'meta.json')) ? readJson(join(certDir, 'meta.json')) : {};
    const harness = meta.harness || (specs.length ? 'slicc-kernel' : 'smoke');
    let skip = null;
    if (!specs.length) skip = 'no cert/*.mjs';
    else if (meta.blocked) skip = 'cert/meta.json is blocked';
    else if (harness !== 'slicc-kernel') skip = `harness ${harness} (not run.mjs)`;
    out.push({ dir, npm, tag, version, upstream, retired, specs, meta, skip });
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
  const referenceIn = (args.reference || '').trim();
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
    if (!/^@[a-z0-9-]+\/[a-z0-9._-]+@[0-9A-Za-z.+-]+$/.test(spec)) {
      throw new Error(`--kernel ${kernelIn}: an npm name@version or dist-tag from the registry, or an artifact name`);
    }
    const view = npmView(spec);
    const t = fetchTarball(view.name, view.version, view.dist?.integrity, join(tmp, 'candidate'));
    renameSync(t.file, join(out, 'candidate.tgz'));
    candidate = kernelInfo(join(out, 'candidate.tgz'), { spec, source: 'npm', gitHead: view.gitHead || null });
  }
  if (candidate.name !== KERNEL) console.log(`::warning::candidate kernel is ${candidate.name}, not ${KERNEL}`);
  let reference;
  if (referenceIn) {
    const spec = /^\d/.test(referenceIn) ? `${KERNEL}@${referenceIn}` : referenceIn;
    if (!/^@ai-ecoverse\/slicc-kernel@[0-9A-Za-z.+-]+$/.test(spec)) {
      throw new Error(`--reference ${referenceIn}: a ${KERNEL} version or dist-tag from the registry (a bare version, or ${KERNEL}@<version|tag>)`);
    }
    const view = npmView(spec);
    if (view.name !== KERNEL) throw new Error(`--reference ${referenceIn} is ${view.name}, not ${KERNEL}`);
    const refTgz = fetchTarball(KERNEL, view.version, view.dist?.integrity, join(tmp, 'reference'));
    renameSync(refTgz.file, join(out, 'reference.tgz'));
    reference = kernelInfo(join(out, 'reference.tgz'), { spec, source: `input reference=${referenceIn}`, origin: 'input', gitHead: view.gitHead || null });
  } else {
    const pinned = bios.base.find((p) => p.name === KERNEL);
    if (!pinned) throw new Error(`slicc-bios ${bios.sha} pins no ${KERNEL}`);
    const refTgz = fetchTarball(KERNEL, pinned.version, pinned.integrity, join(tmp, 'reference'));
    renameSync(refTgz.file, join(out, 'reference.tgz'));
    reference = kernelInfo(join(out, 'reference.tgz'), {
      spec: `${KERNEL}@${pinned.version}`,
      source: `slicc-bios ${bios.sha} src/packages/package-lock.json`,
      origin: 'slicc-bios',
      gitHead: npmView(`${KERNEL}@${pinned.version}`).gitHead || null,
    });
  }

  const all = recipes();
  const byDir = new Map(all.map((r) => [r.dir, r]));
  const byNpm = { get: (name, version) => pickRecipe(all, name, version) };
  const ciCertified = readJson(join(root, 'scripts/ci-certified.json')).packages;
  const entries = new Map();
  const skipped = new Map();
  const latest = new Map();
  const latestOf = (name, tag = 'latest') => {
    const key = `${name}@${tag}`;
    if (!latest.has(key)) {
      try {
        const v = npmView(key);
        latest.set(key, { version: v.version, integrity: v.dist?.integrity || null });
      } catch (err) {
        latest.set(key, { error: String(err.message).split('\n')[0] });
      }
    }
    return latest.get(key);
  };
  const skip = (name, version, origin, reason) => {
    const key = `${name}@${version ?? '-'}`;
    const s = skipped.get(key) || { package: name, recipe: byNpm.get(name, version)?.dir ?? null, version: version ?? null, origin: [], reason };
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
    const l = latestOf(r.npm, r.tag);
    if (l.error) return skip(r.npm, null, origin, `not on npm: ${l.error}`);
    add(r, l.version, l.integrity, origin);
  };
  const tokens = setIn.split(',').map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token === 'base' || token === 'catalog') {
      for (const p of bios[token]) {
        if (p.name === KERNEL) continue;
        const r = byNpm.get(p.name, p.version);
        if (!r) skip(p.name, p.version, token, 'no homescoop recipe');
        else add(r, p.version, p.integrity, token);
      }
    } else if (token === 'ci-certified') {
      for (const dir of ciCertified) addLatest(byDir.get(dir), token);
    } else if (token === 'all') {
      for (const r of all) if (r.specs.length) addLatest(r, token);
    } else {
      const m = /^(@[^@/]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(token);
      const r = m && (byDir.get(m[1]) || byNpm.get(m[1], m[2]) || byNpm.get(`@ai-ecoverse/${m[1]}`, m[2]));
      if (!r) throw new Error(`set: ${token} is neither base, catalog, ci-certified, all nor a homescoop recipe`);
      if (m[2]) {
        if (!/^[0-9A-Za-z.+-]+$/.test(m[2])) throw new Error(`set: ${token}: a version or dist-tag from the registry`);
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
  const timings = loadTimings();
  const units = [];
  const template = (recipe) =>
    Object.entries(timings.versions)
      .filter(([id]) => id.slice(0, id.lastIndexOf('@')) === recipe)
      .map(([, v]) => ({ ...v, runs: {} }))
      .sort((a, b) => costOf(a, Object.keys(a.specs)) - costOf(b, Object.keys(b.specs)))[0];
  list.forEach((e, i) => {
    const v = timings.versions[e.id] || template(e.recipe);
    if (v) {
      const parts = splitEntry(v, e.specs, ESTIMATE.shard, ESTIMATE.limit);
      const measured = timings.versions[e.id] ? 'version' : 'recipe';
      parts.forEach((p, k) => units.push({ id: parts.length > 1 ? `${e.id}#${k + 1}` : e.id, entry: i, specs: p.specs, part: parts.length > 1 ? k + 1 : null, parts: parts.length, seconds: p.seconds, measured }));
    } else {
      const seconds = timings.seconds[e.recipe] ?? ESTIMATE.entry + ESTIMATE.spec * e.specs.length;
      units.push({ id: e.id, entry: i, specs: null, part: null, parts: 1, seconds, measured: e.recipe in timings.seconds ? 'recipe' : null });
    }
  });
  for (const mode of sweep ? sweep.modes : []) {
    const key = `base-sweep:${mode}`;
    units.push({ id: `sweep-${mode}`, sweep: mode, seconds: timings.seconds[key] ?? ESTIMATE.sweep, measured: key in timings.seconds ? 'recipe' : null });
  }
  const total = units.reduce((sum, u) => sum + u.seconds, 0);
  const asked = String(args.shards || 'auto').trim();
  const wanted = asked === 'auto' ? Math.ceil(total / ESTIMATE.shard) : Number(asked);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_SHARDS) throw new Error(`--shards must be auto or 1..${MAX_SHARDS}, not ${asked}`);
  let n = Math.max(1, Math.min(units.length, wanted));
  let bins = pack(units, n);
  while (asked === 'auto' && n < Math.min(units.length, MAX_SHARDS) && Math.max(...bins.map((b) => b.seconds)) > ESTIMATE.limit) {
    n += 1;
    bins = pack(units, n);
  }
  bins = bins.map((b) => ({
    seconds: b.seconds,
    units: b.units.filter((u) => !u.sweep).sort((x, y) => x.entry - y.entry || (x.part || 0) - (y.part || 0)),
    sweeps: b.units.filter((u) => u.sweep).map((u) => u.sweep),
  }));
  const tag = createHash('sha256')
    .update(JSON.stringify([kernelIn, setIn, biosRefIn, homescoopRefIn || homescoopSha, ...(referenceIn ? [referenceIn] : [])]))
    .digest('hex')
    .slice(0, 10);
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const doc = {
    version: 1,
    tag,
    createdAt: new Date().toISOString(),
    inputs: { kernel: kernelIn, set: setIn, biosRef: biosRefIn, homescoopRef: homescoopRefIn || 'HEAD', reference: referenceIn || null },
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
    shards: bins.map((b) => ({
      units: b.units.map((u) => ({ entry: u.entry, specs: u.specs, part: u.part, parts: u.parts, estimateS: u.seconds })),
      sweeps: b.sweeps,
      estimateS: b.seconds,
    })),
    sweep,
  };
  writeJson(join(out, 'plan.json'), doc);
  console.log(`candidate ${candidate.name}@${candidate.version} sha256 ${candidate.sha256}`);
  console.log(`reference ${reference.name}@${reference.version} sha256 ${reference.sha256} (${reference.origin === 'input' ? `input reference ${referenceIn}` : `slicc-bios ${bios.sha}`})`);
  console.log(`work: about ${Math.round(total / 60)} min in ${n} shard(s) (shards ${asked}; ${units.filter((u) => u.measured).length} of ${units.length} items measured in timings.json)`);
  for (const [k, b] of bins.entries()) {
    const label = (u) => (u.part ? `${list[u.entry].id}#${u.part}[${u.specs.join(',')}]` : list[u.entry].id);
    console.log(`shard ${k} (~${Math.round(b.seconds / 60)} min): ${[...b.units.map(label), ...b.sweeps.map((m) => `base-sweep:${m}`)].join(' ')}`);
  }
  for (const s of doc.skipped) console.log(`skip ${s.package}@${s.version ?? '-'} (${s.origin.join(',')}): ${s.reason}`);
  args.gateSummary = `${units.length} items in ${n} shard(s), ${doc.skipped.length} skipped`;
  output('tag', tag);
  output('artifact', `kernel-compat-${tag}`);
  output('shards', JSON.stringify(bins.map((_, k) => k)));
  output('count', String(n));
  output('homescoop-sha', homescoopSha);
}

export function repackPeer(peer, { dir = root } = {}) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts/read-recipe.mjs'), peer, '--json'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`needsRepack ${peer}: no recipe (${(r.stderr || r.stdout).trim().split('\n')[0]})`);
  if (JSON.parse(r.stdout).repack?.from) return { kind: 'repack' };
  const pj = readJson(join(dir, 'packages', peer, 'package', 'package.json'));
  return { kind: 'published', spec: `${pj.name}@${pj.version}` };
}

export function installNeeds(recipe, nm, work) {
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
    const plan = repackPeer(peer);
    if (plan.kind === 'published') {
      console.log(`::warning::${recipe}: needsRepack ${peer} has no repack.from (it builds from source now); installing the published ${plan.spec}. Move it to needs/needsInstall in packages/${recipe}/cert/meta.json`);
      npmInstall([plan.spec]);
      continue;
    }
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

function certRun({ label, kernelFile, recipe, cert, tarballs, users, work, logs, logName, specs = null, env = {} }) {
  const json = join(work, `${label}.json`);
  rmSync(json, { force: true });
  const log = join(logs, `${logName}.${label}.log`);
  const args = [join(here, 'run.mjs'), '--package', recipe, ...(cert ? ['--cert', cert] : [])];
  for (const t of tarballs) args.push('--tarball', t);
  for (const sp of specs || []) args.push('--spec', sp);
  args.push('--kernel', kernelFile, '--users', users, '--json', json, '--soft');
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

export const siteOf = (id) => String(id).replace(/#\d+$/, '');

export function failuresOf(rep) {
  const out = [];
  for (const sp of rep.specs) {
    if (sp.status !== 'fail') continue;
    const fails = sp.cases?.fail || [];
    for (const c of fails) {
      const site = siteOf(c.id);
      out.push({ spec: sp.spec, key: c.id, kind: 'case', text: c.message, site, atSite: fails.filter((x) => siteOf(x.id) === site).length });
    }
    if (sp.crash) out.push({ spec: sp.spec, key: 'crash', kind: 'crash', text: sp.crash.message, signature: sp.crash.signature, where: sp.crash.where });
    if (!sp.cases?.fail.length && !sp.crash) out.push({ spec: sp.spec, key: '(spec)', kind: 'spec', text: sp.error || '' });
  }
  if (!rep.specs.length && rep.status === 'fail') out.push({ spec: '(boot)', key: '(boot)', kind: 'boot', text: rep.error || '' });
  if (rep.pageErrors?.length) out.push({ spec: '(page errors)', key: '(page errors)', kind: 'page', text: rep.pageErrors.join('\n') });
  return out;
}

function lookup(rep, f, { anyAtSite = false } = {}) {
  if (f.kind === 'boot') return rep.specs.length ? 'pass' : 'fail';
  if (f.kind === 'page') return !rep.specs.length ? 'unreached' : rep.pageErrors?.length ? 'fail' : 'pass';
  const sp = rep.specs.find((x) => x.spec === f.spec);
  if (!sp) return 'unreached';
  if (f.kind === 'spec') return sp.status;
  if (f.kind === 'crash') return sp.crash ? (sp.crash.signature === f.signature ? 'fail' : 'crash') : 'pass';
  const fails = sp.cases?.fail || [];
  if (fails.some((c) => c.id === f.key)) return 'fail';
  const site = f.site ?? siteOf(f.key);
  const there = fails.filter((c) => siteOf(c.id) === site).length;
  if (there && (anyAtSite || there >= (f.atSite ?? 1))) return 'fail';
  if (sp.cases?.pass.includes(f.key)) return 'pass';
  if (sp.status === 'pass' && !sp.cases) return 'pass';
  return sp.crash ? 'crash' : 'unreached';
}

export function stillFails(f, again) {
  return lookup(again, f, { anyAtSite: true }) !== 'pass';
}

function refPasses(f, ref) {
  return lookup(ref, f) === 'pass';
}

export function splitOnReference(open, ref) {
  const same = [];
  const rest = [];
  for (const f of open) (lookup(ref, f) === 'fail' ? same : rest).push(f);
  return { same, rest };
}

export function compareOnReference(f, ref) {
  const tries = [ref, ref.other].filter(Boolean);
  const seen = tries.map((r) => lookup(r, f));
  if (seen.includes('pass')) return { verdict: 'regression', reference: 'pass' };
  if (seen.includes('fail')) return { verdict: 'known', reference: 'fail', why: 'fails the same way on the reference kernel' };
  const crash = tries.map((r) => r.specs.find((x) => x.spec === f.spec)?.crash).find(Boolean);
  if (f.kind === 'crash') {
    return { verdict: 'regression', reference: crash ? 'crash' : 'unreached', why: crash ? `the reference crashed otherwise: ${crash.signature}` : 'the reference did not run the spec' };
  }
  if (crash) return { verdict: 'known', reference: 'crash', why: `the reference crashed before this case: ${crash.signature}` };
  if (!tries.some((r) => r.specs.some((x) => x.spec === f.spec))) return { verdict: 'known', reference: 'unreached', why: 'the reference did not run the spec' };
  return { verdict: 'regression', reference: 'unreached', why: 'not reached on the reference' };
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
  for (const u of plan.shards[index]?.units || []) {
    const e = plan.entries[u.entry];
    const name = u.part ? `${slug(e.id)}.part${u.part}` : slug(e.id);
    const work = join(out, 'work', name);
    const started = Date.now();
    const result = { ...e, part: u.part, parts: u.parts, only: u.specs, reruns: 'specs', status: 'fail', verdict: 'error', specs: [], reference: null, peers: [], durationMs: 0 };
    try {
      const tgz = fetchTarball(e.package, e.version, e.integrity, join(work, 'tgz'));
      result.sha256 = tgz.sha256;
      result.integrity = tgz.integrity;
      result.peers = installNeeds(e.recipe, join(work, 'nm'), work);
      const base = { recipe: e.recipe, tarballs: [tgz.file], users: e.users, work, logs, logName: name, specs: u.specs };
      const rerun = (list) => {
        const named = [...new Set(list.map((f) => f.spec))];
        return named.some((sp) => sp.startsWith('(')) ? u.specs : named;
      };
      const facts = (f) => ({
        package: e.package,
        recipe: e.recipe,
        spec: f.spec,
        version: e.version,
        kernel: plan.kernel.version,
        users: e.users,
        text: f.text,
      });
      const limitOf = (f) => findLimit(limits, facts(f));
      let cand = certRun({ ...base, label: 'candidate', kernelFile: candidateFile });
      let fails = failuresOf(cand);
      const attempts = [cand.log];
      let earlyRef = null;
      const unlimited = fails.filter((f) => !limitOf(f));
      if (unlimited.length && !sameKernel) {
        earlyRef = certRun({ ...base, label: 'reference', kernelFile: referenceFile, specs: rerun(unlimited) });
        const { same } = splitOnReference(unlimited, earlyRef);
        for (const f of same) {
          Object.assign(f, { verdict: 'known', reference: 'fail', why: 'fails the same way on the reference kernel', retrySkipped: true });
          console.log(`${e.id} ${f.spec} ${f.key}: retry skipped: the reference fails the same way`);
        }
      }
      const toRetry = unlimited.filter((f) => !f.retrySkipped);
      if (toRetry.length) {
        const again = certRun({ ...base, label: 'candidate-retry', kernelFile: candidateFile, specs: rerun(toRetry) });
        attempts.push(again.log);
        fails = fails.map((f) => (f.retrySkipped || !toRetry.includes(f) || stillFails(f, again) ? f : { ...f, flaky: true }));
      }
      result.status = fails.some((f) => !f.flaky) ? 'fail' : 'pass';
      result.log = cand.log;
      result.attempts = attempts;
      result.kernelSeen = cand.kernel;
      result.modes = cand.modes ?? null;
      const open = [];
      for (const f of fails) {
        if (f.flaky || f.retrySkipped) continue;
        const limit = limitOf(f);
        if (limit) Object.assign(f, { verdict: 'known', limit });
        else open.push(f);
      }
      if (earlyRef && !open.length) {
        result.reference = { status: earlyRef.status, log: earlyRef.log, attempts: [earlyRef.log], error: earlyRef.error || null };
      }
      if (open.length) {
        if (sameKernel) {
          for (const f of open) Object.assign(f, { verdict: 'known', why: 'the candidate is the reference kernel' });
        } else {
          let ref = earlyRef || certRun({ ...base, label: 'reference', kernelFile: referenceFile, specs: rerun(open) });
          const refAttempts = [ref.log];
          if (open.some((f) => !refPasses(f, ref))) {
            const again = certRun({ ...base, label: 'reference-retry', kernelFile: referenceFile, specs: rerun(open.filter((f) => !refPasses(f, ref))) });
            refAttempts.push(again.log);
            ref = { ...ref, other: again };
          }
          result.reference = { status: ref.status, log: ref.log, attempts: refAttempts, error: ref.error || null };
          for (const f of open) Object.assign(f, compareOnReference(f, ref));
        }
      }
      const bySpec = new Map();
      for (const f of fails) bySpec.set(f.spec, [...(bySpec.get(f.spec) || []), f]);
      const worst = (list) => {
        const vs = list.filter((f) => !f.flaky).map((f) => f.verdict);
        return vs.includes('regression') ? 'regression' : vs.includes('known') ? 'known' : 'pass';
      };
      const caseRow = (f) => ({
        id: f.key,
        kind: f.kind,
        message: f.text.split('\n')[0].slice(0, 300),
        verdict: f.flaky ? 'pass' : f.verdict,
        ...(f.flaky ? { flaky: true } : {}),
        ...(f.why ? { why: f.why } : {}),
        ...(f.limit ? { limit: f.limit } : {}),
        ...(f.reference ? { reference: f.reference } : {}),
        ...(f.retrySkipped ? { retry: 'skipped: the reference fails the same way' } : {}),
      });
      result.specs = [
        ...cand.specs.map((sp) => {
          const list = bySpec.get(sp.spec) || [];
          const status = list.some((f) => !f.flaky) ? 'fail' : 'pass';
          return {
            spec: sp.spec,
            status,
            verdict: worst(list),
            durationMs: sp.durationMs,
            assertions: (sp.cases?.pass.length || 0) + (sp.cases?.fail.length || 0),
            ...(list.length ? { cases: list.map(caseRow), error: sp.error } : {}),
            ...(list.length && list.every((f) => f.flaky) ? { flaky: true } : {}),
          };
        }),
        ...[...bySpec.entries()]
          .filter(([spec]) => spec.startsWith('('))
          .map(([spec, list]) => ({ spec, status: list.some((f) => !f.flaky) ? 'fail' : 'pass', verdict: worst(list), cases: list.map(caseRow), error: list[0].text })),
      ];
      const vs = result.specs.map((sp) => sp.verdict);
      result.verdict = vs.includes('regression') ? 'regression' : vs.includes('known') ? 'known' : 'pass';
    } catch (err) {
      result.error = String(err.stack || err).slice(0, 8000);
      console.log(`::error::${e.id}: ${String(err.message).split('\n')[0]}`);
    }
    result.durationMs = Date.now() - started;
    console.log(`${e.id}${u.part ? ` part ${u.part}/${u.parts} (${u.specs.join(', ')})` : ''}: ${result.status} → ${result.verdict} in ${Math.round(result.durationMs / 1000)} s`);
    results.push(result);
    rmSync(work, { recursive: true, force: true });
  }
  const sweeps = (plan.shards[index]?.sweeps || []).map((mode) => sweepMode(plan, kdir, mode, out, limits));
  const finishedAt = new Date();
  writeJson(join(out, `shard-${index}.json`), {
    shard: index,
    runner: process.env.RUNNER_NAME || null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    wallMs: finishedAt - startedAt,
    sweeps,
    results,
  });
  args.gateSummary = `shard ${index}: ${results.length} results, ${sweeps.length} sweep(s)`;
}

function sweepMode(plan, kdir, mode, out, limits) {
  const logs = join(out, 'logs');
  const work = join(out, 'work', `sweep-${mode}`);
  const startedAt = new Date();
  const doc = { mode, runner: process.env.RUNNER_NAME || null, startedAt: startedAt.toISOString(), rows: [], error: null, runs: [] };
  try {
    const tarballs = plan.sweep.packages.map((p) => fetchTarball(p.name, p.version, p.integrity, join(work, 'tgz')).file);
    mkdirSync(join(work, 'nm'), { recursive: true });
    must('npm', ['install', '--prefix', join(work, 'nm'), '--no-fund', '--no-audit', ...HARNESS], { attempts: 3, cwd: root });
    const swept = recipes();
    const byNpm = { get: (name, version) => pickRecipe(swept, name, version)?.dir };
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
      doc.runs.push({ label, status: rep.status, modes: rep.modes ?? null, durationMs: rep.durationMs, log: rep.log, error: rep.error || null });
      return existsSync(rowsFile) ? readJson(rowsFile).rows : null;
    };
    const key = (r) => `${r.user} ${r.command}`;
    let rows = pass('candidate', join(kdir, 'candidate.tgz'));
    if (!rows) {
      rows = [{ user: '-', command: '(boot)', package: null, status: 'fail', rc: null, expected: 0, out: doc.runs[0].error }];
    }
    const facts = (r) => ({
      package: r.package,
      recipe: byNpm.get(r.package, r.version) || null,
      spec: 'base-sweep',
      case: r.command,
      version: r.version,
      kernel: plan.kernel.version,
      users: mode,
      user: r.user,
      rc: r.rc,
    });
    const retry = [...new Set(rows.filter((r) => r.status === 'fail' && r.command !== '(boot)' && !findLimit(limits, facts(r))).map((r) => r.command))];
    if (retry.length) {
      const again = pass('candidate-retry', join(kdir, 'candidate.tgz'), retry);
      if (again) {
        const passedAgain = new Set(again.filter((r) => r.status === 'pass').map(key));
        rows = rows.map((r) => (passedAgain.has(key(r)) ? { ...r, status: 'pass', flaky: true } : r));
      }
    }
    const open = [];
    for (const r of rows) {
      r.recipe = byNpm.get(r.package, r.version) || null;
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
  return { mode, wallMs: doc.wallMs };
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
  const parts = new Map();
  plan.shards.forEach((s, k) => {
    const doc = shardDocs.get(k);
    shards.push({
      shard: k,
      packages: s.units.map((u) => (u.part ? `${plan.entries[u.entry].id}#${u.part}` : plan.entries[u.entry].id)),
      sweeps: s.sweeps,
      estimateS: s.estimateS,
      wallMs: doc?.wallMs ?? null,
      runner: doc?.runner ?? null,
      reported: Boolean(doc),
    });
    for (const u of s.units) {
      const e = plan.entries[u.entry];
      const r = doc?.results.find((x) => x.id === e.id && (x.part ?? null) === (u.part ?? null));
      parts.set(u.entry, [...(parts.get(u.entry) || []), { u, k, r }]);
    }
  });
  const rank = { pass: 0, known: 1, regression: 2, error: 3 };
  for (const [i, got] of [...parts.entries()].sort(([a], [b]) => a - b)) {
    const e = plan.entries[i];
    const lost = got.filter((g) => !g.r);
    for (const g of lost) errors.push(`${e.id}${g.u.part ? ` part ${g.u.part}` : ''}: shard ${g.k} reported nothing`);
    const done = got.filter((g) => g.r).map((g) => g.r);
    if (!done.length) {
      packages.push({ ...e, status: 'fail', verdict: 'error', error: `shard ${got[0].k} reported nothing` });
      results.push({ package: e.package, recipe: e.recipe, version: e.version, sha256: null, spec: null, users: e.users, status: 'fail', verdict: 'error', durationMs: null, log: null });
      continue;
    }
    const verdict = [...done.map((r) => r.verdict), ...(lost.length ? ['error'] : [])].reduce((a, b) => (rank[b] > rank[a] ? b : a), 'pass');
    const r = {
      ...done[0],
      status: done.every((x) => x.status === 'pass') && !lost.length ? 'pass' : 'fail',
      verdict,
      durationMs: done.reduce((sum, x) => sum + (x.durationMs || 0), 0),
      specs: done.flatMap((x) => x.specs).sort((a, b) => String(a.spec).localeCompare(String(b.spec))),
      reference: done.find((x) => x.reference)?.reference || null,
      error: done.map((x) => x.error).filter(Boolean).join('\n') || null,
    };
    for (const x of done) if (x.verdict === 'error') errors.push(`${e.id}${x.part ? ` part ${x.part}` : ''}: ${String(x.error || 'error').split('\n')[0]}`);
    packages.push({ id: r.id, package: r.package, recipe: r.recipe, version: r.version, sha256: r.sha256 ?? null, origin: r.origin, users: r.users, modes: r.modes ?? null, status: r.status, verdict: r.verdict, durationMs: r.durationMs, parts: got.length, reruns: r.reruns || null, peers: r.peers, reference: r.reference ? { status: r.reference.status, log: r.reference.log } : null, error: r.error || null });
    const specs = r.specs.length ? r.specs : [{ spec: null, status: r.status, verdict: r.verdict, error: r.error }];
    for (const s of specs) {
      const from = done.find((x) => x.specs.includes(s)) || r;
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
        log: from.log ? `logs/${from.log.split('/').pop()}` : null,
        ...(s.assertions !== undefined ? { assertions: s.assertions } : {}),
        ...(s.flaky ? { flaky: true } : {}),
        ...(s.error && s.status !== 'pass' ? { error: s.error.slice(0, 2000) } : {}),
        ...(s.cases
          ? {
              cases: s.cases.map((c) => ({
                ...c,
                ...(c.limit ? { limit: { issue: c.limit.issue, why: c.limit.why, kernel: c.limit.kernel } } : {}),
              })),
            }
          : {}),
        ...(from.reference ? { reference: { status: from.reference.status, log: `logs/${from.reference.log.split('/').pop()}` } } : {}),
      });
    }
  }
  for (const s of plan.skipped) {
    results.push({ package: s.package, recipe: s.recipe, version: s.version, sha256: null, spec: null, users: null, status: 'skip', verdict: 'skip', durationMs: null, log: null, why: s.reason });
  }
  const sweepOut = [];
  const sweeps = [];
  if (plan.sweep) {
    for (const mode of plan.sweep.modes) {
      const doc = sweepDocs.get(mode);
      const shard = plan.shards.findIndex((s) => s.sweeps.includes(mode));
      sweeps.push({ mode, shard, wallMs: doc?.wallMs ?? null, runner: doc?.runner ?? null, reported: Boolean(doc), runs: doc?.runs || [] });
      if (!doc) {
        errors.push(`base sweep ${mode}: shard ${shard} reported nothing`);
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
  const expected = (args['expect-regressions'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const byRecipe = new Map();
  for (const r of [...results, ...sweepOut].filter((x) => x.verdict === 'regression')) {
    const name = r.recipe || r.package;
    const e = byRecipe.get(name) || { specs: [], sweep: [] };
    if (r.command) e.sweep.push(`${r.users}/${r.user} ${r.command} rc=${r.rc}`);
    else e.specs.push(r.spec);
    byRecipe.set(name, e);
  }
  const problems = [];
  for (const name of expected) {
    const e = byRecipe.get(name) || { specs: [], sweep: [] };
    const planned = packages.some((p) => p.recipe === name);
    const swept = sweepOut.some((r) => r.recipe === name);
    if (!planned && !swept) problems.push(`${name}: neither in the set nor in the base sweep`);
    if (planned && !e.specs.length) problems.push(`${name}: no spec regression`);
    if (swept && !e.sweep.length) problems.push(`${name}: no base-sweep regression`);
  }
  const compat = {
    kernel: { spec: plan.kernel.spec, name: plan.kernel.name, version: plan.kernel.version, sha256: plan.kernel.sha256, integrity: plan.kernel.integrity, gitHead: plan.kernel.gitHead, source: plan.kernel.source },
    reference: { spec: plan.reference.spec, version: plan.reference.version, sha256: plan.reference.sha256, gitHead: plan.reference.gitHead, source: plan.reference.source, origin: plan.reference.origin || 'slicc-bios' },
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
    ...(expected.length ? { expected: { regressions: expected, holds: !problems.length && !errors.length, problems } } : {}),
  };
  writeJson(join(out, 'compat.json'), compat);

  const k = plan.kernel;
  const md = [];
  md.push(`## kernel-compat: ${k.name}@${k.version} ${ICON[verdict === 'regression' ? 'regression' : verdict]} ${verdict}`);
  md.push('');
  md.push(`- candidate: \`${k.spec}\` → ${k.name}@${k.version}, sha256 \`${k.sha256}\`${k.gitHead ? `, gitHead \`${k.gitHead}\`` : ''}`);
  md.push(plan.reference.origin === 'input'
    ? `- reference (the \`reference\` input, \`${plan.inputs.reference}\`): ${plan.reference.version}, sha256 \`${plan.reference.sha256}\`; base set and catalog from slicc-bios \`${plan.inputs.biosRef}\` = \`${plan.biosRef}\``
    : `- reference (pinned by slicc-bios \`${plan.inputs.biosRef}\` = \`${plan.biosRef}\`): ${plan.reference.version}, sha256 \`${plan.reference.sha256}\``);
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
      .filter((r) => r.cases?.length)
      .map((r) => {
        const counted = {};
        for (const c of r.cases) counted[c.flaky ? 'flaky' : c.verdict] = (counted[c.flaky ? 'flaky' : c.verdict] || 0) + 1;
        const issues = [...new Set(r.cases.map((c) => c.limit?.issue).filter(Boolean))];
        const bad = r.cases.filter((c) => c.verdict === 'regression').slice(0, 2).map((c) => `${c.id}: ${c.message.slice(0, 80)}`);
        return `${r.spec}: ${Object.entries(counted).map(([v, n]) => `${n} ${v}`).join(', ')}${issues.length ? ` (${issues.join(', ')})` : ''}${bad.length ? ` [${bad.join('; ')}]` : ''}`;
      })
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
      for (const r of odd.slice(0, 80)) {
        md.push(`| ${ICON[r.verdict] || ''} | ${r.users} | ${r.user} | \`${cell(r.command)}\` | ${cell(r.recipe || r.package)} | ${r.rc ?? ''} | ${r.reference?.rc ?? ''} | ${cell(r.limit ? `${r.limit.issue}: ${r.limit.why}` : r.why || r.out || '').slice(0, 160)} |`);
      }
      if (odd.length > 80) md.push(`\n${odd.length - 80} more rows in compat.json`);
    }
  }
  if (expected.length) {
    md.push('');
    md.push('### Expected regressions (negative proof)');
    md.push('');
    md.push('| Package | Expected | Spec regressions | Sweep regressions |');
    md.push('| --- | --- | --- | --- |');
    for (const name of [...new Set([...expected, ...byRecipe.keys()])].sort()) {
      const e = byRecipe.get(name) || { specs: [], sweep: [] };
      md.push(`| ${name} | ${expected.includes(name) ? 'yes' : 'no'} | ${cell(e.specs.join(', '))} | ${cell(e.sweep.slice(0, 4).join(', '))}${e.sweep.length > 4 ? ` (+${e.sweep.length - 4})` : ''} |`);
    }
    md.push('');
    md.push(problems.length ? `**Proof fails:** ${problems.map(cell).join('; ')}` : '**Proof holds:** every expected package regresses, in its spec and in the base sweep.');
  }
  md.push('');
  md.push('### Shards');
  md.push('');
  md.push('| Job | Work | Estimate | Wall time | Runner |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const s of shards) {
    const work = [...s.packages, ...s.sweeps.map((m) => `base-sweep:${m} (${secs(sweeps.find((x) => x.mode === m)?.wallMs)})`)].join(' ');
    md.push(`| shard ${s.shard} | ${work} | ${secs(s.estimateS * 1000)} | ${s.reported ? secs(s.wallMs) : 'no report'} | ${s.runner || ''} |`);
  }
  const text = `${md.join('\n')}\n`;
  writeFileSync(join(out, 'summary.md'), text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
  const ran = results.filter((r) => r.verdict !== 'skip').length + sweepOut.filter((r) => r.verdict !== 'skip').length;
  if (!ran) {
    console.log(`::error::kernel-compat: the report has 0 rows that ran (${results.length + sweepOut.length} skipped); a run that tested nothing is not a pass`);
    console.log('compat report: FAIL 0 rows');
    process.exit(1);
  }
  args.gateSummary = `${ran} rows, ${regressions} regression(s), verdict ${verdict}`;
  output('verdict', verdict);
  output('regressions', String(regressions));
  if (errors.length) {
    console.log(`::error::kernel-compat could not answer for ${errors.length} item(s): ${errors.join('; ').slice(0, 1000)}`);
    process.exit(1);
  }
  if (expected.length) {
    if (problems.length) {
      console.log(`::error::negative proof fails on ${k.name}@${k.version}: ${problems.join('; ')}`);
      process.exit(1);
    }
    console.log(`::notice::negative proof holds on ${k.name}@${k.version}: ${expected.join(', ')} regress; all regressions: ${[...byRecipe.keys()].join(', ')}`);
    return;
  }
  if (regressions) {
    const msg = `${regressions} regression(s) on ${k.name}@${k.version} against ${plan.reference.version}: ${[...byRecipe.keys()].join(', ')}`;
    console.log(failOnRegression ? `::error::${msg}` : `::warning::${msg}`);
    if (failOnRegression) process.exit(1);
  }
}

function timings(args) {
  const out = resolve(args.out || join(here, 'timings.json'));
  const doc = existsSync(out) ? readJson(out) : { sources: [], seconds: {}, versions: {} };
  const measured = {};
  const versions = {};
  const sources = [];
  for (const file of String(args.compat || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const c = readJson(resolve(file));
    sources.push({ run: c.run?.url || null, kernel: c.kernel.version, set: c.inputs?.set || null });
    for (const p of c.packages || []) {
      if (typeof p.durationMs !== 'number') continue;
      measured[p.recipe] = Math.max(measured[p.recipe] || 0, Math.ceil(p.durationMs / 1000));
      const rows = (c.results || []).filter((r) => r.recipe === p.recipe && r.version === p.version && r.spec && !r.spec.startsWith('('));
      if (!rows.length || rows.some((r) => typeof r.durationMs !== 'number')) continue;
      const runsOf = (r) => {
        const cases = (r.cases || []).filter((x) => !x.flaky && !x.limit);
        if (cases.length && cases.every((x) => x.retry)) return 2;
        if (cases.length) return cases.some((x) => x.reference !== 'pass') ? 4 : 3;
        return (r.cases || []).some((x) => x.flaky) ? 2 : 1;
      };
      const v = { setup: 0, specs: {}, runs: {} };
      for (const r of rows) {
        v.specs[r.spec] = Math.ceil(r.durationMs / 1000);
        if (runsOf(r) > 1) v.runs[r.spec] = runsOf(r);
      }
      const most = Math.max(1, ...Object.values(v.runs));
      const total = p.durationMs / 1000;
      const specTime = rows.reduce((sum, r) => sum + (r.durationMs / 1000) * (p.reruns === 'specs' ? runsOf(r) : most), 0);
      v.setup = Math.max(5, Math.ceil((total - specTime) / (most * (p.parts || 1))));
      const id = `${p.recipe}@${p.version}`;
      const specs = Object.keys(v.specs);
      if (!versions[id] || costOf(v, specs) > costOf(versions[id], Object.keys(versions[id].specs))) versions[id] = v;
    }
    for (const sw of c.sweeps || []) {
      if (typeof sw.wallMs !== 'number') continue;
      const key = `base-sweep:${sw.mode}`;
      measured[key] = Math.max(measured[key] || 0, Math.ceil(sw.wallMs / 1000));
    }
  }
  if (!sources.length) throw new Error('--compat <compat.json>[,<compat.json>…] is required');
  const seconds = { ...doc.seconds, ...measured };
  const merged = { ...(doc.versions || {}), ...versions };
  const key = (x) => `${x.run} ${x.kernel} ${x.set}`;
  const known = new Set(sources.map(key));
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(out, {
    sources: [...(doc.sources || []).filter((x) => !known.has(key(x))), ...sources],
    seconds: sorted(seconds),
    versions: sorted(Object.fromEntries(Object.entries(merged).map(([id, v]) => [id, { setup: v.setup, specs: sorted(v.specs), runs: sorted(v.runs) }]))),
  });
  console.log(`timings: ${Object.keys(measured).length} recipes and ${Object.keys(versions).length} versions measured; ${Object.keys(seconds).length} recipes, ${Object.keys(merged).length} versions in ${relative(root, out)}`);
}

const commands = { plan, shard, report, timings };
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
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
    console.error(`compat ${args._[0]}: FAIL ${String(err.message || err).split('\n')[0]}`);
    process.exit(1);
  }
  console.log(`compat ${args._[0]}: PASS${args.gateSummary ? ` ${args.gateSummary}` : ''}`);
}
