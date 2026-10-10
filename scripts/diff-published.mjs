#!/usr/bin/env node
/**
 * Diff a package tarball against a published one: a packaging-only release
 * may change package.json's "version" and the versions of its @ai-ecoverse/*
 * dependencies, nothing else.
 *
 *   node scripts/diff-published.mjs <new.tgz> <@scope/name@version | base.tgz> [--allow README.md]...
 *
 * Every tarball entry other than package/package.json (and --allow'd files)
 * must be byte-identical to the base, same path, type and mode. In
 * package.json only "version" and the values (not the names) of
 * @ai-ecoverse/* entries in dependencies / peerDependencies /
 * optionalDependencies may differ, and those values must be exact versions.
 * Prints a report (file counts, both tarball sha256s, the package.json diff);
 * exits 1 on any other difference.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { EXACT } from './check-exact-pins.mjs';

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const SCOPE = '@ai-ecoverse/';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Minimal tar reader (ustar + pax 'x' + GNU 'L'), enough for npm pack output.
 * @param {Buffer} tgz
 * @returns {Map<string, { type: string, mode: number, size: number, sha256: string, data: Buffer, link: string }>}
 */
export function readTarball(tgz) {
  const buf = gunzipSync(tgz);
  const out = new Map();
  const str = (b) => {
    const i = b.indexOf(0);
    return b.subarray(0, i < 0 ? b.length : i).toString('utf8');
  };
  const num = (b) => {
    if (b[0] & 0x80) {
      let n = 0;
      for (let i = 1; i < b.length; i++) n = n * 256 + b[i];
      return n;
    }
    const s = str(b).trim();
    return s ? parseInt(s, 8) : 0;
  };
  let off = 0;
  /** @type {Record<string,string>} */
  let pax = {};
  let longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = str(h.subarray(0, 100));
    const mode = num(h.subarray(100, 108)) & 0o7777;
    let size = num(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 0x30);
    let link = str(h.subarray(157, 257));
    if (str(h.subarray(257, 263)).startsWith('ustar')) {
      const prefix = str(h.subarray(345, 500));
      if (prefix) name = `${prefix}/${name}`;
    }
    if (pax.size) size = Number(pax.size);
    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      if (type === 'g') continue;
      pax = {};
      let p = 0;
      const text = data.toString('utf8');
      while (p < text.length) {
        const sp = text.indexOf(' ', p);
        const len = parseInt(text.slice(p, sp), 10);
        if (!len) break;
        const rec = text.slice(sp + 1, p + len - 1);
        const eq = rec.indexOf('=');
        pax[rec.slice(0, eq)] = rec.slice(eq + 1);
        p += len;
      }
      continue;
    }
    if (type === 'L') {
      longName = str(data);
      continue;
    }
    if (longName) name = longName;
    if (pax.path) name = pax.path;
    if (pax.linkpath) link = pax.linkpath;
    pax = {};
    longName = null;
    const t = type === '\0' || type === '7' ? '0' : type;
    out.set(name, { type: t, mode, size, sha256: sha256(data), data: Buffer.from(data), link });
  }
  return out;
}

/** npm pack <spec> into a temp dir; returns the tarball bytes. */
export function fetchPublished(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-base-'));
  try {
    const r = spawnSync('npm', ['pack', spec, '--pack-destination', dir, '--silent'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm pack ${spec} failed: ${r.stderr || r.stdout}`);
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack ${spec}: no tarball`);
    return readFileSync(join(dir, tgz));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canon = (v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : Array.isArray(v)
      ? v.map(canon)
      : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** @returns {{ errors: string[], changes: string[] }} */
export function diffPackageJson(base, next) {
  const errors = [];
  const changes = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const k of keys) {
    if (k === 'version') {
      if (base.version === next.version) errors.push(`version unchanged (${base.version}); bump -N`);
      else changes.push(`version: ${base.version} → ${next.version}`);
      continue;
    }
    if (DEP_FIELDS.includes(k)) {
      const a = base[k] || {};
      const b = next[k] || {};
      const names = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const n of names) {
        if (!(n in a)) errors.push(`${k}["${n}"] added`);
        else if (!(n in b)) errors.push(`${k}["${n}"] removed`);
        else if (a[n] !== b[n]) {
          if (!n.startsWith(SCOPE)) errors.push(`${k}["${n}"] changed (${a[n]} → ${b[n]}); only @ai-ecoverse pins may change`);
          else if (!EXACT.test(b[n])) errors.push(`${k}["${n}"] = ${b[n]} is not exact`);
          else changes.push(`${k}["${n}"]: ${a[n]} → ${b[n]}`);
        }
      }
      continue;
    }
    if (!same(base[k], next[k])) errors.push(`package.json "${k}" changed; only version and @ai-ecoverse pins may`);
  }
  return { errors, changes };
}

/**
 * @param {Buffer} nextTgz
 * @param {Buffer} baseTgz
 * @param {{ allow?: string[], baseLabel?: string }} [opts]
 */
export function diffTarballs(nextTgz, baseTgz, opts = {}) {
  const allow = new Set(['package/package.json', ...(opts.allow || []).map((f) => `package/${f}`)]);
  const base = readTarball(baseTgz);
  const next = readTarball(nextTgz);
  const errors = [];
  const lines = [];
  let identical = 0;
  for (const [path, e] of base) {
    const n = next.get(path);
    if (!n) {
      errors.push(`${path}: missing from the new tarball`);
      continue;
    }
    const meta = n.type === e.type && n.mode === e.mode && n.link === e.link;
    if (allow.has(path)) {
      if (!meta) errors.push(`${path}: type/mode changed (${e.mode.toString(8)} → ${n.mode.toString(8)})`);
      if (n.sha256 !== e.sha256) lines.push(`changed ${path}`);
      continue;
    }
    if (!meta || n.sha256 !== e.sha256) {
      errors.push(`${path}: differs (${e.sha256.slice(0, 12)} ${e.mode.toString(8)} → ${n.sha256.slice(0, 12)} ${n.mode.toString(8)})`);
    } else identical++;
  }
  for (const path of next.keys()) if (!base.has(path)) errors.push(`${path}: added`);

  const bp = base.get('package/package.json');
  const np = next.get('package/package.json');
  let pj = { errors: ['package/package.json missing'], changes: [] };
  let textDiff = '';
  if (bp && np) {
    const a = JSON.parse(bp.data.toString('utf8'));
    const b = JSON.parse(np.data.toString('utf8'));
    pj = diffPackageJson(a, b);
    const dir = mkdtempSync(join(tmpdir(), 'homescoop-pjdiff-'));
    try {
      writeFileSync(join(dir, 'a'), bp.data);
      writeFileSync(join(dir, 'b'), np.data);
      const r = spawnSync('diff', ['-u', '--label', `${a.name}@${a.version}/package.json`, '--label', `${b.name}@${b.version}/package.json`, 'a', 'b'], { cwd: dir, encoding: 'utf8' });
      textDiff = r.stdout;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  errors.push(...pj.errors);
  const report = [
    `base ${opts.baseLabel || '(tarball)'} sha256 ${sha256(baseTgz)} (${base.size} entries)`,
    `new  sha256 ${sha256(nextTgz)} (${next.size} entries)`,
    `${identical} of ${base.size} entries byte-identical (path, type, mode, content); other changes:`,
    ...lines.map((l) => `  ${l}`),
    ...pj.changes.map((c) => `  package.json ${c}`),
    '',
    textDiff.trimEnd(),
  ];
  return { ok: errors.length === 0, errors, report: report.join('\n') };
}

function main() {
  const args = process.argv.slice(2);
  const allow = [];
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow') allow.push(args[++i]);
    else pos.push(args[i]);
  }
  if (pos.length !== 2) {
    console.error('usage: diff-published.mjs <new.tgz> <@scope/name@version | base.tgz> [--allow FILE]...');
    process.exit(2);
  }
  const [nextPath, baseSpec] = pos;
  const baseTgz = baseSpec.endsWith('.tgz') ? readFileSync(baseSpec) : fetchPublished(baseSpec);
  const res = diffTarballs(readFileSync(nextPath), baseTgz, { allow, baseLabel: baseSpec });
  console.log(res.report);
  if (!res.ok) {
    console.error('\ndiff-published: not a packaging-only change:');
    for (const e of res.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\ndiff-published: ok — packaging-only (package.json version and @ai-ecoverse pins)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
