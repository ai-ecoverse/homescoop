#!/usr/bin/env node
/**
 * Download recipe source URL(s) and rewrite sha256 in recipe.yaml.
 *
 *   node scripts/refresh-recipe-sha.mjs zlib
 *   node scripts/refresh-recipe-sha.mjs bash
 *   node scripts/refresh-recipe-sha.mjs --all
 *   node scripts/refresh-recipe-sha.mjs zlib --check
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.includes('--all');
const checkOnly = args.includes('--check');
const names = all
  ? readdirSync(join(root, 'packages')).filter((d) =>
      existsSync(join(root, 'packages', d, 'recipe.yaml'))
    )
  : args.filter((a) => !a.startsWith('-'));

if (!names.length) {
  console.error('usage: refresh-recipe-sha.mjs <package>|--all');
  process.exit(2);
}

function recipeJson(name) {
  const r = spawnSync(
    process.execPath,
    [join(root, 'scripts/read-recipe.mjs'), name, '--json'],
    { encoding: 'utf8', cwd: root }
  );
  if (r.status !== 0) throw new Error(r.stderr || `read-recipe ${name}`);
  return JSON.parse(r.stdout);
}

function splitVersion(v) {
  const raw = String(v || '');
  const m = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[.-](.+))?$/);
  if (!m) return { major: '', minor: '', patch: '', extra: '', amal: '' };
  const major = m[1] || '0';
  const minor = m[2] || '0';
  const patch = m[3] || '0';
  const amal = `${Number(major)}${String(Number(minor)).padStart(2, '0')}${String(Number(patch)).padStart(2, '0')}00`;
  return { major, minor, patch, extra: m[4] || '', amal };
}

function expand(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`unknown {{${k}}}`);
    return vars[k];
  });
}

function sha256File(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function fetchSha(url) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-sha-'));
  const dest = join(dir, 'blob');
  try {
    execFileSync(
      'curl',
      ['-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '-o', dest, url],
      { stdio: ['ignore', 'inherit', 'inherit'] }
    );
    return sha256File(dest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Replace a specific sha256 value. Prefer exact old→new; for multi-source
 * recipes that share no unique old sha, match the nearest sha256 after a
 * url: line containing a distinctive fragment.
 */
function replaceSha(text, { oldSha, newSha, urlHint }) {
  if (oldSha && oldSha.length === 64 && text.includes(oldSha)) {
    return text.replace(oldSha, newSha);
  }
  // Find url line containing hint, then the next sha256
  const lines = text.split('\n');
  let hintIdx = -1;
  if (urlHint) {
    const frag = urlHint.replace(/\{\{[^}]+\}\}/g, '');
    const needle = frag.slice(0, 40);
    hintIdx = lines.findIndex((l) => l.includes('url:') && (l.includes(needle) || l.includes(urlHint)));
  }
  const start = hintIdx >= 0 ? hintIdx : 0;
  for (let i = start; i < Math.min(lines.length, start + 8); i++) {
    const m = lines[i].match(/^(\s*sha256:\s*")([0-9a-fA-F]{64})("\s*)$/);
    if (m) {
      lines[i] = `${m[1]}${newSha}${m[3]}`;
      return lines.join('\n');
    }
  }
  // Fallback: first sha256 in file
  const re = /sha256:\s*"([0-9a-fA-F]{64})"/;
  if (!re.test(text)) throw new Error('no sha256 field to replace');
  return text.replace(re, `sha256: "${newSha}"`);
}

function refreshOne(name) {
  const recipe = recipeJson(name);
  const path = join(root, 'packages', name, 'recipe.yaml');
  let text = readFileSync(path, 'utf8');
  const version = String(recipe.version || '');

  /** @type {{ key: string|null, src: Record<string, unknown> }[]} */
  const jobs = [];
  if (recipe.source && recipe.source.url) {
    jobs.push({ key: null, src: recipe.source });
  }
  const sources = recipe.sources || {};
  for (const [k, v] of Object.entries(sources)) {
    if (v && typeof v === 'object' && /** @type {any} */ (v).url) {
      jobs.push({ key: k, src: /** @type {Record<string, unknown>} */ (v) });
    }
  }

  for (const job of jobs) {
    const src = job.src;
    const srcVersion = String(src.version || version);
    const sp = splitVersion(srcVersion);
    const vars = {
      version: srcVersion,
      major: sp.major,
      minor: sp.minor,
      patch: sp.patch,
      extra: sp.extra || '',
      amal: String(src.amal || sp.amal),
      year: String(src.year || ''),
    };
    let url;
    try {
      url = expand(String(src.url || ''), vars);
    } catch (e) {
      console.log(`skip ${name}${job.key ? '/' + job.key : ''}: ${e.message}`);
      continue;
    }
    if (!url || url === 'null') {
      console.log(`skip ${name}${job.key ? '/' + job.key : ''}: no url`);
      continue;
    }
    console.log(`== ${name}${job.key ? ' sources.' + job.key : ''}: ${url}`);
    let digest;
    try {
      digest = fetchSha(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `${name}: download failed for ${url} (${msg}). ` +
          'Make source.url derive from {{version}} / {{major}}.{{minor}}.'
      );
    }
    const oldSha = String(src.sha256 || '');
    if (oldSha === digest) {
      console.log(`   sha256 unchanged: ${digest}`);
      continue;
    }
    if (checkOnly) {
      throw new Error(
        `${name}: recipe sha256 ${oldSha || '(empty)'} != downloaded ${digest} for ${url}. ` +
          'Renovate does not update checksums; wait for the recipe-sha job or run refresh-recipe-sha.mjs.'
      );
    }
    text = replaceSha(text, {
      oldSha,
      newSha: digest,
      urlHint: String(src.url || ''),
    });
    console.log(`   sha256: ${oldSha || '(none)'} → ${digest}`);
  }

  if (!checkOnly) writeFileSync(path, text);
}

for (const name of names) {
  try {
    const builder = spawnSync(
      process.execPath,
      [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'builder'],
      { encoding: 'utf8', cwd: root }
    ).stdout.trim();
    if (builder === 'retired') {
      console.log(`skip ${name}: retired`);
      continue;
    }
    const recipe = recipeJson(name);
    if (recipe.repack?.from) {
      // Packaging-only repack of a published tarball: the source is not built.
      console.log(`skip ${name}: repack of ${recipe.repack.from}`);
      continue;
    }
    if (!recipe.source?.url || recipe.source.url === null) {
      console.log(`skip ${name}: null source`);
      continue;
    }
    refreshOne(name);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
