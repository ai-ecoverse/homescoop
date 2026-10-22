#!/usr/bin/env node
/**
 * Every package a cert installs runs on that cert's kernel, so the kernel must
 * satisfy each one's engines.slicc-kernel (homescoop#1292). wasm-bash 5.3.0-21
 * declares >=1.130.2; a cert/meta.json that pins kernel 1.128.0 and leaves
 * wasm-bash unpinned gets `sh` exit 126 on every shell call.
 *
 *   node scripts/cert-kernel-floor.mjs             # check, offline, from the snapshot
 *   node scripts/cert-kernel-floor.mjs --refresh   # rewrite the snapshot from npm
 *
 * What it resolves, as the harness installs it (scripts/cert-review/harness.sh,
 * the PR run's cert job, scripts/wasix-lib-cert.mjs): `needsInstall || needs`
 * (a pinned version, a dist-tag, a range, or a bare name for npm latest), then
 * each one's dependencies (npm's highest match), and needsRepack peers at this
 * checkout's package/package.json. needsTarballScripts tarballs are built by
 * their script and aren't resolved. The kernels: cert/meta.json `kernel` (or
 * the root package.json dev-pin when it names none, as cert-kernel.mjs does),
 * and each extra_kernels object that runs specs (cert-leg.mjs browser-extra
 * runs them with the same needs).
 *
 * Offline, from scripts/cert-kernel-floor-snapshot.json, because the check
 * runs in every PR's exact-pins job (`node --test scripts/test/*.test.mjs`):
 * a registry outage, or a publish of some other package, must not turn an
 * unrelated PR red. A published version's manifest never changes, so the
 * snapshot is exact for pins. For a bare name the snapshot's latest can lag,
 * so the check also resolves it to this checkout's recipe version (the one
 * the publish puts under latest): a PR that raises a package's
 * engines.slicc-kernel fails here, before npm has the version. A pin the
 * snapshot doesn't know fails with the --refresh command.
 *
 * Today's violations are in scripts/cert-kernel-floor-allowlist.txt, one
 * "<recipe> #<issue> <npm name>[,<npm name>…] <reason>" line per cert. It
 * exempts only the needs it names: another need above the cert kernel still
 * fails, and a named need (or a line) that no longer violates fails ("drop
 * it"), so the list only shrinks.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRecipes } from './npm-tag.mjs';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KERNEL = '@ai-ecoverse/slicc-kernel';
export const SNAPSHOT = 'scripts/cert-kernel-floor-snapshot.json';
export const ALLOWLIST = 'scripts/cert-kernel-floor-allowlist.txt';
export const REFRESH = 'node scripts/cert-kernel-floor.mjs --refresh';
const REGISTRY = 'https://registry.npmjs.org/';

// ---- semver, npm's rules for what these specs use (=, <, <=, >, >=, ^, ~, *) ----

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
  const m = VERSION.exec(String(v ?? '').trim());
  return m ? { tuple: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}

export function compare(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.tuple[i] !== y.tuple[i]) return x.tuple[i] < y.tuple[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p < +q ? -1 : 1;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const same = (a, b) => a.tuple.every((n, i) => n === b.tuple[i]);

function comparators(part) {
  const c = part.trim();
  if (c === '' || c === '*' || c === 'x') return [];
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(c);
  const v = parseVersion(m[2]);
  if (!v) throw new Error(`not a range: ${part}`);
  const op = m[1] || '=';
  if (op === '^' || op === '~') {
    const [a, b, p] = v.tuple;
    const up = op === '~' ? [a, b + 1, 0] : a > 0 ? [a + 1, 0, 0] : b > 0 ? [0, b + 1, 0] : [0, 0, p + 1];
    return [{ op: '>=', v }, { op: '<', v: { tuple: up, pre: ['0'] } }];
  }
  return [{ op, v }];
}

/** npm's satisfies: a prerelease matches only a comparator set that names a prerelease of its own x.y.z. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  return String(range ?? '*')
    .split('||')
    .some((alt) => {
      const set = alt.trim().split(/\s+/).flatMap(comparators);
      const ok = set.every(({ op, v: w }) => {
        const c = compare(v, w);
        return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
      });
      if (!ok || !v.pre.length) return ok;
      return set.some(({ v: w }) => w.pre.length > 0 && same(v, w));
    });
}

export function maxSatisfying(versions, range) {
  return versions.filter((v) => satisfies(v, range)).sort(compare).pop() ?? null;
}

// ---- what the harness installs ----

export function parseSpec(spec) {
  const m = /^(@[^/@\s]+\/[^@\s]+|[^@\s]+)(?:@(.+))?$/.exec(String(spec ?? '').trim());
  if (!m) throw new Error(`not an npm spec: ${JSON.stringify(spec)}`);
  return { name: m[1], ref: m[2] ?? 'latest' };
}

/**
 * Where a name's versions come from: the snapshot (npm) and this checkout's
 * recipes. `repo` is a list of { version, tag, manifest } for recipes that
 * publish that name.
 */
export function makeSource({ snapshot = { packages: {} }, recipes = [] } = {}) {
  const repo = new Map();
  for (const r of recipes) {
    if (!repo.has(r.npm)) repo.set(r.npm, []);
    repo.get(r.npm).push(r);
  }
  return {
    known: (name) => Boolean(snapshot.packages?.[name]) || repo.has(name),
    npm: (name) => snapshot.packages?.[name] ?? null,
    repo: (name) => repo.get(name) ?? [],
  };
}

/** One version's manifest bits: { engines, dependencies } (npm's first, this checkout's when unpublished). */
function manifestAt(source, name, version) {
  const pub = source.npm(name)?.versions?.[version];
  if (pub) return { engines: pub.engines ?? null, dependencies: pub.dependencies ?? {}, from: 'npm' };
  const own = source.repo(name).find((r) => r.version === version);
  if (own) return { engines: own.manifest.engines?.['slicc-kernel'] ?? null, dependencies: own.manifest.dependencies ?? {}, from: 'checkout' };
  return null;
}

/** The version(s) npm would install for name@ref. A dist-tag latest also gives this checkout's latest recipe. */
export function versionsFor(source, name, ref) {
  const pub = source.npm(name);
  const own = source.repo(name);
  if (parseVersion(ref)) {
    if (!manifestAt(source, name, ref)) throw new Error(`${name}@${ref} is not in ${SNAPSHOT}: run ${REFRESH}`);
    return [ref];
  }
  if (/^[A-Za-z][\w.-]*$/.test(ref) && ref !== 'x') {
    const out = [];
    if (pub?.tags?.[ref]) out.push(pub.tags[ref]);
    for (const r of own) if (r.tag === ref && r.version && !r.retired) out.push(r.version);
    if (!out.length) throw new Error(`${name}@${ref}: no such dist-tag in ${SNAPSHOT} or a recipe here: run ${REFRESH}`);
    return [...new Set(out)];
  }
  const all = [...Object.keys(pub?.versions ?? {}), ...own.filter((r) => r.version && !r.retired).map((r) => r.version)];
  const best = maxSatisfying([...new Set(all)], ref);
  if (!best) throw new Error(`${name}@${ref}: no version in ${SNAPSHOT} or a recipe here satisfies it: run ${REFRESH}`);
  return [best];
}

/**
 * Every package (name@version) a spec installs, with its engines.slicc-kernel
 * and the chain that pulls it in. `missing` collects the names the source
 * doesn't know (for --refresh) instead of throwing when it's given.
 */
export function closure(source, roots, { missing = null } = {}) {
  const out = [];
  const seen = new Set();
  // npm keeps a root (installed at the top of node_modules) for a dependency
  // whose range it satisfies, rather than nesting the highest match.
  const top = new Map();
  for (const r of roots) {
    try {
      if (source.known(r.name)) top.set(r.name, versionsFor(source, r.name, r.ref));
    } catch {
      // walk() reports it
    }
  }
  const walk = (name, ref, via, dep = false) => {
    const hoisted = dep ? (top.get(name) ?? []).filter((v) => satisfies(v, ref)) : [];
    if (hoisted.length) return;
    if (!source.known(name)) {
      if (missing) return void missing.add(name);
      throw new Error(`${name} is not in ${SNAPSHOT}: run ${REFRESH}`);
    }
    let versions;
    try {
      versions = versionsFor(source, name, ref);
    } catch (err) {
      if (missing) return void missing.add(name);
      throw err;
    }
    for (const version of versions) {
      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = manifestAt(source, name, version);
      out.push({ name, version, engines: m.engines, from: m.from, via: [...via, key] });
      for (const [dep, range] of Object.entries(m.dependencies)) walk(dep, range, [...via, key], true);
    }
  };
  for (const r of roots) walk(r.name, r.ref, r.via ?? []);
  return out;
}

/** The roots a cert/meta.json installs: needsInstall || needs, and needsRepack peers at this checkout's version. */
export function rootsOf(meta, recipeDirs = new Map()) {
  const roots = (meta.needsInstall || meta.needs || []).map((s) => ({ ...parseSpec(s), via: [] }));
  for (const peer of meta.needsRepack || []) {
    const r = recipeDirs.get(peer);
    if (!r?.version) throw new Error(`needsRepack ${peer}: no packages/${peer}/package/package.json version`);
    roots.push({ name: r.npm, ref: r.version, via: [`needsRepack ${peer}`] });
  }
  return roots;
}

/** The kernels a cert/meta.json boots with its needs: `kernel` (or the dev-pin), and extra_kernels objects with specs. */
export function kernelsOf(meta, devPinVersion) {
  const out = [];
  const add = (spec, why) => {
    const { name, ref } = parseSpec(spec);
    if (name !== KERNEL || !parseVersion(ref)) throw new Error(`${why} ${spec} is not an exact ${KERNEL}@<version>`);
    out.push({ version: ref, why });
  };
  if (meta.kernel) add(meta.kernel, 'kernel');
  else out.push({ version: devPinVersion, why: 'kernel (the package.json dev-pin; cert/meta.json names none)' });
  for (const e of Array.isArray(meta.extra_kernels) ? meta.extra_kernels : []) {
    if (e && typeof e === 'object' && e.specs !== undefined && typeof e.kernel === 'string') add(e.kernel, 'extra_kernels');
  }
  return out;
}

/** Pure: one package's violations on its kernels, [{ need: npm name, message }]. */
export function floorProblems(pkg, kernels, installed) {
  const out = [];
  for (const k of kernels) {
    for (const p of installed) {
      if (!p.engines || satisfies(k.version, p.engines)) continue;
      const chain = p.via.length > 1 ? ` (via ${p.via.slice(0, -1).join(' → ')})` : '';
      out.push({ need: p.name, message: `packages/${pkg}/cert/meta.json: ${k.why} ${KERNEL}@${k.version} is below ${p.name}@${p.version}'s engines.slicc-kernel ${p.engines}${chain}` });
    }
  }
  return out;
}

const LINE = '<recipe> #<issue> <npm name>[,<npm name>…] <reason>';

/** One line per cert, naming the needs whose floor it is below: a violation by any other need still fails. */
export function parseAllowlist(text) {
  const entries = new Map();
  const problems = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-z0-9][a-z0-9._-]*)\s+(#\d+)\s+((?:@[a-z0-9-]+\/)?[a-z0-9._-]+(?:,(?:@[a-z0-9-]+\/)?[a-z0-9._-]+)*)\s+(\S.*)$/.exec(line);
    if (!m) problems.push(`${ALLOWLIST}: "${line}" is not "${LINE}"`);
    else if (entries.has(m[1])) problems.push(`${ALLOWLIST}: ${m[1]} is listed twice`);
    else entries.set(m[1], { issue: m[2], needs: m[3].split(','), reason: m[4] });
  }
  return { entries, problems };
}

// ---- the checkout ----

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadCheckout(dir = defaultRoot) {
  const recipes = listRecipes(dir).map((r) => {
    const pj = join(dir, 'packages', r.dir, 'package', 'package.json');
    return { ...r, manifest: existsSync(pj) ? readJson(pj) : {} };
  });
  const recipeDirs = new Map(recipes.map((r) => [r.dir, r]));
  const metas = readdirSync(join(dir, 'packages'))
    .filter((p) => existsSync(join(dir, 'packages', p, 'cert', 'meta.json')))
    .filter((p) => recipeDirs.has(p) && !recipeDirs.get(p).retired)
    .sort()
    .map((pkg) => ({ pkg, meta: readJson(join(dir, 'packages', pkg, 'cert', 'meta.json')) }));
  const devPin = readJson(join(dir, 'package.json')).devDependencies?.[KERNEL];
  if (!parseVersion(devPin)) throw new Error(`package.json devDependencies ${KERNEL} is ${JSON.stringify(devPin)}, not an exact version`);
  const snapFile = join(dir, SNAPSHOT);
  const snapshot = existsSync(snapFile) ? readJson(snapFile) : { packages: {} };
  return { recipes, recipeDirs, metas, devPin, snapshot };
}

/** The whole check: { results: [{ pkg, problems, allowed }], problems } where `problems` fail it. */
export function check({ recipes, recipeDirs, metas, devPin, snapshot }, allowText) {
  const source = makeSource({ snapshot, recipes });
  const { entries, problems } = parseAllowlist(allowText);
  const results = [];
  const names = new Set(metas.map((m) => m.pkg));
  for (const name of entries.keys()) {
    if (!names.has(name)) problems.push(`${ALLOWLIST} lists ${name}, which has no packages/${name}/cert/meta.json (or is retired): drop the line`);
  }
  for (const { pkg, meta } of metas) {
    let found;
    try {
      found = floorProblems(pkg, kernelsOf(meta, devPin), closure(source, rootsOf(meta, recipeDirs)));
    } catch (err) {
      problems.push(`packages/${pkg}/cert/meta.json: ${err.message}`);
      continue;
    }
    const allowed = entries.get(pkg) ?? null;
    const named = new Set(allowed?.needs ?? []);
    problems.push(...found.filter((f) => !named.has(f.need)).map((f) => f.message));
    if (allowed && !found.length) {
      problems.push(`${ALLOWLIST} lists ${pkg} (${allowed.issue}), but its cert kernel satisfies every need's engines.slicc-kernel: drop the line`);
    } else if (allowed) {
      const stale = allowed.needs.filter((n) => !found.some((f) => f.need === n));
      if (stale.length) problems.push(`${ALLOWLIST} lists ${stale.join(', ')} for ${pkg} (${allowed.issue}), but its cert kernel satisfies ${stale.length > 1 ? 'their' : 'its'} engines.slicc-kernel: drop ${stale.length > 1 ? 'them' : 'it'} from the line`);
    }
    results.push({ pkg, found, allowed });
  }
  return { results, problems };
}

export function verdictLines({ results, problems }) {
  const listed = results.filter((r) => r.found.length && r.allowed);
  if (problems.length) {
    return [...problems.map((p) => `cert-kernel-floor: FAIL ${p}`), `cert-kernel-floor: FAIL ${problems.length} problem(s) in ${results.length} cert/meta.json file(s)`];
  }
  return [
    ...listed.flatMap((r) => r.found.map((f) => `cert-kernel-floor: allowlisted ${r.pkg} (${r.allowed.issue}): ${f.message}`)),
    `cert-kernel-floor: PASS ${results.length} cert/meta.json file(s): every cert kernel satisfies its needs' engines.slicc-kernel, ${listed.length} allowlisted`,
  ];
}

// ---- --refresh ----

async function packument(name) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${REGISTRY}${name.replace('/', '%2f')}`, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`GET ${REGISTRY}${name}: ${last.message}`);
}

/** Fetch every name the certs' closures reach (cached per name), and keep only what the check reads. */
export async function refresh(checkout, fetchPackument = packument) {
  const packages = {};
  const cache = new Map();
  for (;;) {
    const missing = new Set();
    const source = makeSource({ snapshot: { packages }, recipes: checkout.recipes });
    for (const { meta } of checkout.metas) {
      try {
        closure(source, rootsOf(meta, checkout.recipeDirs), { missing });
      } catch {
        // a needsRepack without a version: the check reports it
      }
    }
    const todo = [...missing].filter((n) => !cache.has(n));
    if (!todo.length) break;
    await Promise.all(
      todo.map(async (name) => {
        const doc = await fetchPackument(name);
        cache.set(name, doc);
        if (!doc) return;
        const versions = {};
        for (const [v, m] of Object.entries(doc.versions ?? {}).sort(([a], [b]) => compare(a, b))) {
          const e = {};
          if (m.engines?.['slicc-kernel']) e.engines = m.engines['slicc-kernel'];
          if (m.dependencies && Object.keys(m.dependencies).length) e.dependencies = m.dependencies;
          versions[v] = e;
        }
        packages[name] = { tags: doc['dist-tags'] ?? {}, versions };
      }),
    );
  }
  const sorted = Object.fromEntries(Object.keys(packages).sort().map((n) => [n, packages[n]]));
  return {
    note: `npm manifests (engines.slicc-kernel, dependencies, dist-tags) of every package a cert/meta.json installs; written by ${REFRESH}. Read by scripts/test/cert-kernel-floor.test.mjs (homescoop#1292).`,
    packages: sorted,
  };
}

function stringify(snapshot) {
  const lines = ['{', `  "note": ${JSON.stringify(snapshot.note)},`, '  "packages": {'];
  const names = Object.keys(snapshot.packages);
  names.forEach((n, i) => {
    const p = snapshot.packages[n];
    lines.push(`    ${JSON.stringify(n)}: {`, `      "tags": ${JSON.stringify(p.tags)},`, '      "versions": {');
    const vs = Object.entries(p.versions);
    vs.forEach(([v, e], j) => lines.push(`        ${JSON.stringify(v)}: ${JSON.stringify(e)}${j < vs.length - 1 ? ',' : ''}`));
    lines.push('      }', `    }${i < names.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = defaultRoot;
  try {
    const checkout = loadCheckout(dir);
    if (process.argv.includes('--refresh')) {
      const snap = await refresh(checkout);
      writeFileSync(join(dir, SNAPSHOT), stringify(snap));
      console.error(`cert-kernel-floor: wrote ${SNAPSHOT} (${Object.keys(snap.packages).length} packages)`);
      checkout.snapshot = snap;
    }
    const allow = existsSync(join(dir, ALLOWLIST)) ? readFileSync(join(dir, ALLOWLIST), 'utf8') : '';
    const lines = verdictLines(check(checkout, allow));
    for (const l of lines) console.log(l);
    process.exit(lines.at(-1).startsWith('cert-kernel-floor: PASS') ? 0 : 1);
  } catch (err) {
    console.log(`cert-kernel-floor: FAIL ${err.message}`);
    process.exit(1);
  }
}
