import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN = /(?<![\w.@])(v?)(\d+(?:\.\d+)+(?:-\d+)?(?:p\d+)?(?:\.post\d+)?)(?!\w|[.-]\w)/g;
const PACKAGING_REV = /^\d+\.\d+\.\d+-\d+$/;
const PLAIN = /^\d+\.\d+\.\d+$/;
const UNIT = /^[ \u00a0\u202f]?(?:[%×]|(?:[nµu]?s|ms|sec|secs|seconds?|min|mins|minutes?|h|hrs?|hours?|[KMGTP]i?B|kB|kiB|B|bytes?|x|fps|[kMG]?Hz)(?!\w))/;

export function loadAllow(file = join(root, 'scripts/package-meta-versions.json')) {
  const allow = JSON.parse(readFileSync(file, 'utf8'));
  return {
    historical: allow.historical || [],
    leads: allow.leads || {},
    spellings: allow.spellings || {},
  };
}

export function npmify(v) {
  if (/^\d+$/.test(v)) return `${v}.0.0`;
  if (/^\d+\.\d+$/.test(v)) return `${v}.0`;
  return v;
}

function norm(v) {
  return npmify(String(v).replace(/^v/, '')).replace(/[.-]post/, '.post');
}

export function sameVersion(a, b) {
  return norm(a) === norm(b);
}

export function spellingsFor(allow, name, upstream) {
  const s = allow.spellings[name]?.[upstream];
  return s === undefined ? [] : [].concat(s);
}

function leadsFor(allow, name) {
  return Object.entries(allow.leads)
    .filter(([k]) => k === name || (k.endsWith('*') && name.startsWith(k.slice(0, -1))))
    .flatMap(([, v]) => v);
}

export function isSpelling(allow, name, upstream, v) {
  return v !== undefined && [String(upstream), ...spellingsFor(allow, name, String(upstream))].some((s) => sameVersion(v, s));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineAt(text, off) {
  const start = text.lastIndexOf('\n', off - 1) + 1;
  const nl = text.indexOf('\n', off);
  const end = nl < 0 ? text.length : nl;
  return { start, end, line: text.slice(0, start).split('\n').length, text: text.slice(start, end) };
}

function sentenceAt(text, off) {
  const ln = lineAt(text, off);
  const rel = off - ln.start;
  let start = 0;
  let end = ln.text.length;
  for (const m of ln.text.matchAll(/[.!?](?=\s|$)/g)) {
    if (m.index < rel) start = m.index + 1;
    else if (m.index > rel) { end = m.index; break; }
  }
  return ln.text.slice(start, end);
}

function historicalCue(sentence, allow) {
  return allow.historical.find((w) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(sentence));
}

function afterLead(text, off, leads) {
  const ln = lineAt(text, off);
  const before = text.slice(ln.start, off).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return leads.find((l) => l && before.endsWith(l));
}

export function rewriteVersion(text, from, to, { allow, name }) {
  const changes = [];
  const kept = [];
  if (!from || !to || from === to) return { text, changes, kept };
  const lead = /\./.test(from) ? '(?<![\\w.@])' : '(?<![\\w.@-])';
  const re = new RegExp(`${lead}(v?)${escapeRe(from)}(?!\\w|[.-]\\w)`, 'g');
  const leads = leadsFor(allow, name);
  const out = text.replace(re, (m, v, off) => {
    const ln = lineAt(text, off);
    const cue = historicalCue(sentenceAt(text, off), allow);
    const ld = afterLead(text, off, leads);
    if (cue || ld) {
      kept.push({ line: ln.line, from, reason: cue ? `historical "${cue}"` : `lead "${ld.trim()}"`, excerpt: ln.text.trim() });
      return m;
    }
    changes.push({ line: ln.line, from: `${v}${from}`, to: `${v}${to}`, excerpt: ln.text.trim() });
    return `${v}${to}`;
  });
  return { text: out, changes, kept };
}

export function rewriteUpstream(text, from, to, ctx) {
  const first = rewriteVersion(text, from, to, ctx);
  const changes = [...first.changes];
  const kept = [...first.kept];
  let out = first.text;
  const f = String(from).split('.');
  const t = String(to).split('.').length >= f.length ? String(to).split('.') : npmify(String(to)).split('.');
  for (let n = f.length - 1; n >= 2; n--) {
    const pf = f.slice(0, n).join('.');
    const pt = t.slice(0, n).join('.');
    if (pf === pt || !/^\d+(?:\.\d+)+$/.test(pf) || !/^\d+(?:\.\d+)+$/.test(pt)) continue;
    const r = rewriteVersion(out, pf, pt, ctx);
    out = r.text;
    changes.push(...r.changes);
    kept.push(...r.kept);
  }
  return { text: out, changes, kept };
}

function componentPrefix(tok, upstream) {
  const t = tok.split('.');
  const u = upstream.split('.');
  return t.length < u.length && t.every((c, i) => c === u[i]);
}

export function staleVersions(text, upstream, { allow, name }) {
  const out = [];
  const up = String(upstream);
  const major = up.split('.')[0];
  const ok = [up, ...spellingsFor(allow, name, up)];
  const leads = leadsFor(allow, name);
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[2];
    if (tok.split('.')[0] !== major) continue;
    if (ok.some((o) => sameVersion(tok, o))) continue;
    if (componentPrefix(tok, up)) continue;
    if (PACKAGING_REV.test(tok) && !up.includes('-')) continue;
    if (UNIT.test(text.slice(m.index + m[0].length))) continue;
    if (historicalCue(sentenceAt(text, m.index), allow)) continue;
    if (afterLead(text, m.index, leads)) continue;
    const ln = lineAt(text, m.index);
    const lead = /(\S+\s+)$/.exec(text.slice(ln.start, m.index).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))?.[1];
    out.push({ line: ln.line, version: `${m[1]}${tok}`, excerpt: ln.text.trim(), lead });
  }
  return out;
}

/**
 * A dashed upstream (ImageMagick's 7.1.2-34) makes "34-N" one alphanumeric
 * semver identifier, compared as text, so 34-10 would sort below 34-9. Its
 * packaging revisions are -1 to -9, then -9.1, -9.2, … (docs/versioning.md).
 */
export const isDashedBase = (base) => /^\d+\.\d+\.\d+-[0-9A-Za-z]/.test(String(base));
export function dashedRevision(base, version) {
  const v = String(version || '');
  if (!isDashedBase(base) || !v.startsWith(`${base}-`)) return null;
  const rev = v.slice(`${base}-`.length);
  if (/^(?:[1-9]|9\.[1-9]\d*)$/.test(rev)) return 'ok';
  if (/^[1-9]\d+$/.test(rev)) return 'unsorted';
  return null;
}

export function versionBase(version) {
  const v = String(version || '');
  const dashed = /^(\d+\.\d+\.\d+-[0-9A-Za-z]+)-9\.[1-9]\d*$/.exec(v);
  if (dashed) return dashed[1];
  const m = /^(.*\d)-(\d+)$/.exec(v);
  if (m && /^\d+\.\d+\.\d+$/.test(m[1])) return m[1];
  const post = /^(.*-post\d+)\.\d+$/.exec(v);
  if (post) return post[1];
  if (m) return m[1];
  return v;
}

export function summaryLine(recipeText) {
  const m = /^summary:[ \t]*(.*)$/m.exec(recipeText);
  return m ? { index: m.index, text: m[0] } : null;
}

export function driftErrors({ name, upstream, pkg, summary, readme, allow = loadAllow() }) {
  const errors = [];
  const up = String(upstream);
  const spell = [up, ...spellingsFor(allow, name, up)];
  const version = String(pkg.version || '');
  const base = versionBase(version);
  if (dashedRevision(npmify(up), version) === 'unsorted') {
    errors.push(`package.json version "${version}" sorts below ${npmify(up)}-9 (a dashed upstream's "-N" is compared as text): after -9 use -9.1, -9.2, … (docs/versioning.md)`);
  } else if (!sameVersion(base, up)) {
    errors.push(`package.json version "${version}" is not a packaging revision of recipe version ${up} (run: node scripts/sync-package-version.mjs ${name} --write)`);
  } else if (PLAIN.test(version)) {
    errors.push(`package.json version "${version}" is plain; sync-package-version publishes ${npmify(up)}-1 (run: node scripts/sync-package-version.mjs ${name} --write)`);
  }
  const hsUp = pkg.homescoop?.upstream;
  if (hsUp !== undefined && !spell.some((s) => sameVersion(hsUp, s))) {
    errors.push(`package.json homescoop.upstream "${hsUp}" != recipe version ${up}`);
  }
  const texts = [
    ['package.json description', String(pkg.description || '')],
    ['recipe.yaml summary', String(summary || '')],
    ['package/README.md', String(readme || '')],
  ];
  for (const [label, text] of texts) {
    for (const s of staleVersions(text, up, { allow, name })) {
      const hint = s.lead ? `the text before it, ${JSON.stringify(s.lead)},` : 'the text before it';
      errors.push(`${label}:${s.line} names ${s.version}, not recipe version ${up}: ${s.excerpt.slice(0, 120)} (another project's version? add ${hint} to leads[${JSON.stringify(name)}] in scripts/package-meta-versions.json)`);
    }
  }
  return errors;
}

export function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
