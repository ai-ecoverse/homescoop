#!/usr/bin/env node
/**
 * certification-exceptions.json: the versions bios's v2 gate rejects even
 * though they have ladder-build@main provenance (docs/ci-cert.md, "Certification
 * exceptions"). bios reads the file at a pinned homescoop commit.
 *
 *   node scripts/certification-exceptions.mjs
 *       schema check, plus "every known-inputs.txt line has a fail entry" (offline)
 *   node scripts/certification-exceptions.mjs --check
 *       the same, plus npm and GitHub: every package and version is published,
 *       a range matches at least one published version, every issue exists
 *   node scripts/certification-exceptions.mjs --audit <lockfile>...
 *       one `pin: PASS|DENY|FAIL <name>@<v> (<why>)` line per homescoop pin in
 *       the lockfiles (package-lock.json v2/v3 or pnpm-lock.yaml v9)
 *
 * --file <path> reads another exceptions file, and --fixtures <dir> reads npm
 * from <dir>/packument and <dir>/attestations (repack-input.mjs's fixture
 * layout) and the issues from <dir>/issues.json, a list of URLs, instead of
 * the network. The last line is always `certification-exceptions: PASS|FAIL`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkProvenance, fixtureRegistry, npmRegistry, parseKnownInputs, KNOWN_INPUTS, REPO_URL } from './cert-review/repack-input.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = join(root, 'certification-exceptions.json');
export const GATE = 'certification-exceptions';
const SLSA = 'https://slsa.dev/provenance/v1';

const TOP_KEYS = ['schema', 'entries'];
const ENTRY_KEYS = ['package', 'versions', 'range', 'verdict', 'requires', 'issue', 'ruling'];
const VERDICTS = ['fail', 'requires'];
const PACKAGE = /^@ai-ecoverse\/[a-z0-9][a-z0-9._-]*$/;
const ISSUE = /^https:\/\/github\.com\/(ai-ecoverse\/[A-Za-z0-9._-]+)\/issues\/([1-9]\d*)$/;
const RULING_MAX = 400;

// ---- semver: exact versions and the comparator subset (=, <, <=, >, >=, ||) ----
// bios reads ranges with node-semver and includePrerelease: true. For this
// subset that is plain version order, so this reader and bios agree; anything
// else (^, ~, x-ranges, hyphen ranges, a space after the operator) is refused.

const ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${ID}(?:\\.${ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

export function parseVersion(v) {
  const m = VERSION.exec(typeof v === 'string' ? v : '');
  return m ? { tuple: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}

export function compareVersions(a, b) {
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

/** A range as alternatives of comparator sets; throws on anything outside the subset. */
export function parseRange(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('an empty range');
  return text.split('||').map((alt) => {
    const tokens = alt.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error(`an empty alternative in "${text}"`);
    return tokens.map((t) => {
      const m = /^(<=|>=|<|>|=)?(.+)$/.exec(t);
      const v = parseVersion(m[2]);
      if (!v) throw new Error(`"${t}" in "${text}" isn't <op><exact version> (only =, <, <=, >, >= and ||)`);
      return { op: m[1] || '=', v };
    });
  });
}

/** node-semver's satisfies(version, range, { includePrerelease: true }) for the subset. */
export function inRange(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  return parseRange(range).some((set) =>
    set.every(({ op, v: w }) => {
      const c = compareVersions(v, w);
      return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
    }),
  );
}

export function covers(entry, version) {
  if (Array.isArray(entry.versions)) return entry.versions.includes(version);
  return typeof entry.range === 'string' && inRange(version, entry.range);
}

// ---- the schema ----

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Every problem with the document, as strings; an empty list means valid. */
export function validate(doc) {
  const errors = [];
  if (!isObject(doc)) return ['the file is not a JSON object'];
  for (const k of Object.keys(doc)) if (!TOP_KEYS.includes(k)) errors.push(`unknown top-level key "${k}"`);
  if (doc.schema !== 1) errors.push(`schema is ${JSON.stringify(doc.schema)}, not 1`);
  if (!Array.isArray(doc.entries)) return [...errors, 'entries is not an array'];
  const exact = new Map();
  doc.entries.forEach((e, i) => {
    const at = `entry ${i}${isObject(e) && typeof e.package === 'string' ? ` (${e.package})` : ''}`;
    if (!isObject(e)) return errors.push(`${at} is not an object`);
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) errors.push(`${at}: unknown key "${k}"`);
    if (typeof e.package !== 'string' || !PACKAGE.test(e.package)) errors.push(`${at}: package must be @ai-ecoverse/<name>`);
    const hasVersions = Object.hasOwn(e, 'versions');
    const hasRange = Object.hasOwn(e, 'range');
    if (hasVersions === hasRange) errors.push(`${at}: needs exactly one of versions or range`);
    if (hasVersions) {
      if (!Array.isArray(e.versions) || !e.versions.length) errors.push(`${at}: versions must be a non-empty list`);
      else {
        const seen = new Set();
        for (const v of e.versions) {
          if (!parseVersion(v)) errors.push(`${at}: ${JSON.stringify(v)} is not an exact version`);
          else if (seen.has(v)) errors.push(`${at}: ${v} is listed twice`);
          seen.add(v);
        }
      }
    }
    if (hasRange) {
      try {
        parseRange(e.range);
      } catch (error) {
        errors.push(`${at}: range: ${error.message}`);
      }
    }
    if (!VERDICTS.includes(e.verdict)) errors.push(`${at}: verdict ${JSON.stringify(e.verdict)} is not one of ${VERDICTS.join(', ')}`);
    if (e.verdict === 'requires') {
      if (!isObject(e.requires) || !Object.keys(e.requires).length) errors.push(`${at}: a requires entry needs requires: { <package>: <range> }`);
      else
        for (const [name, range] of Object.entries(e.requires)) {
          if (!PACKAGE.test(name)) errors.push(`${at}: requires names ${JSON.stringify(name)}, not @ai-ecoverse/<name>`);
          try {
            parseRange(range);
          } catch (error) {
            errors.push(`${at}: requires ${name}: ${error.message}`);
          }
        }
    } else if (Object.hasOwn(e, 'requires')) errors.push(`${at}: requires is only for verdict "requires"`);
    if (typeof e.issue !== 'string' || !ISSUE.test(e.issue)) errors.push(`${at}: issue must be https://github.com/ai-ecoverse/<repo>/issues/<n>`);
    if (typeof e.ruling !== 'string' || !e.ruling.trim() || /[\r\n]/.test(e.ruling) || e.ruling.length > RULING_MAX) {
      errors.push(`${at}: ruling must be one non-empty line of at most ${RULING_MAX} characters`);
    }
    if (hasVersions && Array.isArray(e.versions) && typeof e.package === 'string') {
      for (const v of e.versions) {
        const key = `${e.package}@${v}`;
        if (exact.has(key)) errors.push(`${at}: ${key} is also in entry ${exact.get(key)}`);
        else exact.set(key, i);
      }
    }
  });
  if (errors.length) return errors;
  // An exact version that another entry's range also covers is ambiguous.
  doc.entries.forEach((e, i) => {
    if (!Object.hasOwn(e, 'range')) return;
    for (const [key, j] of exact) {
      const at = key.lastIndexOf('@');
      if (key.slice(0, at) === e.package && j !== i && inRange(key.slice(at + 1), e.range)) errors.push(`entry ${i} (${e.package}): range ${e.range} also covers ${key} (entry ${j})`);
    }
  });
  return errors;
}

/** Every known-inputs.txt line (the #864 FAIL set) must have a fail entry. */
export function knownInputsMissing(doc, knownText) {
  const missing = [];
  for (const { npm, version, issue } of parseKnownInputs(knownText).values()) {
    if (!doc.entries.some((e) => e.package === npm && e.verdict === 'fail' && covers(e, version))) missing.push(`${npm}@${version} (#${issue}) is in known-inputs.txt but has no fail entry`);
  }
  return missing;
}

// ---- npm and GitHub ----

export function fixtureIssues(dir) {
  const file = join(dir, 'issues.json');
  const urls = new Set(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
  return async (url) => urls.has(url);
}

export function githubIssues() {
  const cache = new Map();
  return async (url) => {
    if (cache.has(url)) return cache.get(url);
    const [, repo, n] = ISSUE.exec(url) || [];
    let ok = false;
    if (repo) {
      try {
        ok = execFileSync('gh', ['api', `repos/${repo}/issues/${n}`, '--jq', '.number'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === n;
      } catch {
        ok = false;
      }
    }
    cache.set(url, ok);
    return ok;
  };
}

/** Problems found against npm and GitHub: an unknown package, version or issue is a typo. */
export async function checkOnline(doc, { registry, issueExists }) {
  const errors = [];
  const packuments = new Map();
  for (const [i, e] of doc.entries.entries()) {
    const at = `entry ${i} (${e.package})`;
    if (!packuments.has(e.package)) packuments.set(e.package, await registry.packument(e.package));
    const pack = packuments.get(e.package);
    if (!pack?.versions) {
      errors.push(`${at}: ${e.package} isn't on npm`);
      continue;
    }
    const published = Object.keys(pack.versions);
    if (Array.isArray(e.versions)) {
      for (const v of e.versions) if (!pack.versions[v]) errors.push(`${at}: ${e.package}@${v} isn't on npm`);
    } else if (!published.some((v) => inRange(v, e.range))) errors.push(`${at}: range ${e.range} matches no published version of ${e.package}`);
    for (const name of Object.keys(e.requires || {})) {
      if (!packuments.has(name)) packuments.set(name, await registry.packument(name));
      if (!packuments.get(name)?.versions) errors.push(`${at}: requires ${name}, which isn't on npm`);
    }
    if (!(await issueExists(e.issue))) errors.push(`${at}: ${e.issue} doesn't exist`);
  }
  return errors;
}

// ---- lockfiles ----

/** Pins in a package-lock.json (v2/v3) or pnpm-lock.yaml (v9): [{ name, version, integrity, file }]. */
export function readLockfile(text, file = 'lockfile') {
  const pins = [];
  if (/^\s*\{/.test(text)) {
    const lock = JSON.parse(text);
    if (!isObject(lock.packages)) throw new Error(`${file}: no "packages" map (lockfileVersion ${lock.lockfileVersion}; v2 or v3 needed)`);
    for (const [path, entry] of Object.entries(lock.packages)) {
      const at = path.lastIndexOf('node_modules/');
      if (at < 0 || !isObject(entry) || entry.link || !entry.version) continue;
      pins.push({ name: entry.name || path.slice(at + 'node_modules/'.length), version: entry.version, integrity: entry.integrity || null, file });
    }
    return pins;
  }
  if (!/^lockfileVersion:\s*'?9\./m.test(text)) throw new Error(`${file}: not a package-lock.json or a pnpm-lock.yaml v9`);
  let section = '';
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const top = /^([A-Za-z][\w-]*):/.exec(line);
    if (top) {
      section = top[1];
      current = null;
      continue;
    }
    if (section !== 'packages') continue;
    const key = /^ {2}'?([^'\s][^']*?)'?:\s*(\{\})?\s*$/.exec(line);
    if (key) {
      const spec = key[1];
      const at = spec.lastIndexOf('@');
      current = at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1), integrity: null, file } : null;
      if (current) pins.push(current);
      continue;
    }
    const integrity = /^ {4}resolution:\s*\{.*\bintegrity:\s*([^,}\s]+)/.exec(line);
    if (integrity && current) current.integrity = integrity[1];
  }
  return pins;
}

/** The npm names homescoop publishes: every packages/<n>/package/package.json. */
export function homescoopNames(dir = root) {
  const names = new Set();
  for (const d of readdirSync(join(dir, 'packages'))) {
    const file = join(dir, 'packages', d, 'package', 'package.json');
    if (existsSync(file)) names.add(JSON.parse(readFileSync(file, 'utf8')).name);
  }
  return names;
}

// ---- the audit ----

function statementOf(doc) {
  const slsa = (doc?.attestations || []).find((a) => a?.predicateType === SLSA);
  try {
    return JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** `hosted`, `pool` (a self-hosted runner) or what the provenance says instead. */
export function runnerOf(doc) {
  const id = statementOf(doc)?.predicate?.runDetails?.builder?.id || '';
  return id === 'https://github.com/actions/runner/github-hosted' ? 'hosted' : id === 'https://github.com/actions/runner/self-hosted' ? 'pool' : id ? `builder ${id}` : 'no builder id';
}

const fromHomescoop = (doc) => statementOf(doc)?.predicate?.buildDefinition?.externalParameters?.workflow?.repository === REPO_URL;

/**
 * One row per distinct homescoop name@version in `pins`. A pin is homescoop's
 * when `names` (today's packages/) has it, when an entry names it (entries
 * outlive the tree), or when its provenance names homescoop's repository.
 * `pins` holds every lockfile pin, homescoop's or not, because a requires
 * entry checks bios's own pins of the required package: every one of them
 * must satisfy the range.
 */
export async function audit({ doc, pins, names, registry }) {
  const ours = new Set([...names, ...doc.entries.map((e) => e.package)]);
  const groups = new Map();
  for (const p of pins) {
    if (!ours.has(p.name) && !(p.name.startsWith('@ai-ecoverse/') && fromHomescoop(await registry.attestations(p.name, p.version)))) continue;
    const key = `${p.name}@${p.version}`;
    if (!groups.has(key)) groups.set(key, { name: p.name, version: p.version, integrities: new Set(), files: new Set() });
    groups.get(key).integrities.add(p.integrity);
    groups.get(key).files.add(p.file);
  }
  const rows = [];
  for (const g of [...groups.values()].sort((a, b) => (a.name === b.name ? compareVersions(a.version, b.version) : a.name.localeCompare(b.name)))) {
    const row = (verdict, why) => rows.push({ verdict, name: g.name, version: g.version, why });
    const integrities = [...g.integrities];
    const pack = await registry.packument(g.name);
    const meta = pack?.versions?.[g.version];
    if (!meta) {
      row('FAIL', `not on npm`);
      continue;
    }
    if (integrities.length !== 1 || !integrities[0]) {
      row('FAIL', integrities.some((x) => !x) ? 'a lockfile records no integrity' : 'the lockfiles record different integrities');
      continue;
    }
    if (integrities[0] !== meta.dist?.integrity) {
      row('FAIL', `lockfile integrity ${integrities[0].slice(0, 19)}… isn't npm's ${String(meta.dist?.integrity).slice(0, 19)}…`);
      continue;
    }
    if (meta.deprecated) {
      row('FAIL', `npm-deprecated: ${String(meta.deprecated).split('\n')[0]}`);
      continue;
    }
    const att = await registry.attestations(g.name, g.version);
    const prov = checkProvenance(att, { npm: g.name, version: g.version, integrity: meta.dist.integrity });
    const entries = doc.entries.filter((e) => e.package === g.name && covers(e, g.version));
    const fail = entries.find((e) => e.verdict === 'fail');
    if (fail) {
      row('DENY', `${fail.issue}: ${fail.ruling}${prov.ok ? '' : '; also no ladder-build@main provenance'}`);
      continue;
    }
    const notes = [];
    let denied = null;
    for (const e of entries.filter((x) => x.verdict === 'requires')) {
      for (const [name, range] of Object.entries(e.requires)) {
        const theirs = [...new Set(pins.filter((p) => p.name === name).map((p) => p.version))];
        const bad = theirs.filter((v) => !inRange(v, range));
        if (!theirs.length) denied = `requires ${name} ${range}, which bios doesn't pin (${e.issue})`;
        else if (bad.length) denied = `requires ${name} ${range}; bios pins ${bad.join(', ')} (${e.issue})`;
        else notes.push(`requires ${name} ${range}: bios pins ${theirs.join(', ')}`);
      }
    }
    if (denied) {
      row('DENY', denied);
      continue;
    }
    if (!prov.ok) {
      row('FAIL', prov.reason);
      continue;
    }
    const runner = runnerOf(att);
    if (runner !== 'hosted' && runner !== 'pool') {
      row('FAIL', `provenance from ${runner}, not a hosted or pool runner`);
      continue;
    }
    row('PASS', [`ladder-build@main ${prov.commit.slice(0, 10)}, ${runner}`, ...notes].join('; '));
  }
  return rows;
}

export const pinLine = (r) => `pin: ${r.verdict} ${r.name}@${r.version} (${r.why})`;

// ---- CLI ----

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string', default: FILE },
      known: { type: 'string', default: KNOWN_INPUTS },
      check: { type: 'boolean', default: false },
      audit: { type: 'boolean', default: false },
      fixtures: { type: 'string' },
    },
  });
  const fail = (why) => {
    console.log(`${GATE}: FAIL ${why}`);
    process.exit(1);
  };
  let doc;
  try {
    doc = JSON.parse(readFileSync(values.file, 'utf8'));
  } catch (error) {
    fail(`${values.file} can't be read as JSON: ${error.message.split('\n')[0]}`);
  }
  const errors = validate(doc);
  if (!errors.length) errors.push(...knownInputsMissing(doc, readFileSync(values.known, 'utf8')));
  const registry = values.fixtures ? fixtureRegistry(values.fixtures) : npmRegistry();
  if (!errors.length && (values.check || values.audit)) {
    const issueExists = values.fixtures ? fixtureIssues(values.fixtures) : githubIssues();
    errors.push(...(await checkOnline(doc, { registry, issueExists })));
  }
  for (const e of errors) console.log(`${GATE}: error: ${e}`);
  if (errors.length) fail(`${basename(values.file)}: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
  const summary = `${basename(values.file)}: ${doc.entries.length} entries valid${values.check || values.audit ? ', every package, version and issue exists' : ''}`;
  if (!values.audit) {
    console.log(`${GATE}: PASS ${summary}`);
    return;
  }
  if (!positionals.length) fail('--audit needs at least one lockfile');
  const pins = positionals.flatMap((f) => readLockfile(readFileSync(f, 'utf8'), f));
  const rows = await audit({ doc, pins, names: homescoopNames(), registry });
  for (const r of rows) console.log(pinLine(r));
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const tally = `${rows.length} homescoop pins: ${count('PASS')} PASS, ${count('DENY')} DENY, ${count('FAIL')} FAIL`;
  if (!rows.length) fail(`${summary}; no homescoop pins in ${positionals.join(', ')}`);
  if (count('PASS') !== rows.length) fail(`${summary}; ${tally}`);
  console.log(`${GATE}: PASS ${summary}; ${tally}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.log(`${GATE}: FAIL ${String(error.message || error).split('\n')[0]}`);
    process.exit(2);
  });
}
