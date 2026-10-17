#!/usr/bin/env node
/**
 * Download recipe source URL(s) and rewrite sha256 in recipe.yaml.
 *
 *   node scripts/refresh-recipe-sha.mjs zlib
 *   node scripts/refresh-recipe-sha.mjs bash
 *   node scripts/refresh-recipe-sha.mjs --all
 *   node scripts/refresh-recipe-sha.mjs zlib --check
 *   node scripts/refresh-recipe-sha.mjs py-numpy --verify-repack
 *
 * Repack recipes (repack.from) never fetch their source, so a wrong sha256
 * would never fail a build (#730). Builds skip them (their bytes come from
 * npm, not the source); with --verify-repack (ladder-pr's recipe-sha job)
 * they are verified, never rewritten, and a mismatch fails.
 *
 * scripts/recipe-sha-allowlist.txt lists the known mismatches, one
 * `<package> #<issue> <reason>` per line. An entry can't outlive its fix:
 * with --verify-repack it fails once the pins match, once the issue is
 * closed, or once scripts/cert-review/repack-input.mjs finds the package's
 * repack chain attested. RECIPE_SHA_FIXTURES=<json> ({ issues: { N: "OPEN" },
 * attested: { pkg: false } }) stands in for GitHub and npm in tests.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { say } from './gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.includes('--all');
const checkOnly = args.includes('--check');
const verifyRepack = args.includes('--verify-repack');
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

/** @returns {Map<string, { line: string, issue: number }>} package → its allowlist entry */
function readAllowlist(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const [i, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+#(\d+)\s+\S/);
    if (!m) throw new Error(`${path}:${i + 1}: want "<package> #<issue> <reason>", got "${line}"`);
    out.set(m[1], { line, issue: Number(m[2]) });
  }
  return out;
}

function refreshOne(name, { check = checkOnly, why = '', mismatches = null } = {}) {
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
    if (String(src.sha256 || '') === 'skip') {
      // Unpinned on purpose: build.sh stages a prebuilt artifact, not this URL.
      console.log(`skip ${name}${job.key ? '/' + job.key : ''}: sha256 skip (prebuilt, not fetched)`);
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
    if (mismatches) {
      mismatches.push(`${job.key ? `sources.${job.key}` : 'source'}: ${oldSha || '(empty)'} != ${digest}`);
      continue;
    }
    if (check) {
      throw new Error(
        `${name}: recipe sha256 ${oldSha || '(empty)'} != downloaded ${digest} for ${url}. ` +
          (why ||
            'Renovate does not update checksums; wait for the recipe-sha job or run refresh-recipe-sha.mjs.')
      );
    }
    text = replaceSha(text, {
      oldSha,
      newSha: digest,
      urlHint: String(src.url || ''),
    });
    console.log(`   sha256: ${oldSha || '(none)'} → ${digest}`);
  }

  if (!check) writeFileSync(path, text);
}

const allowlist = readAllowlist(join(root, 'scripts/recipe-sha-allowlist.txt'));
const fixtures = process.env.RECIPE_SHA_FIXTURES ? JSON.parse(readFileSync(process.env.RECIPE_SHA_FIXTURES, 'utf8')) : null;

/** OPEN / CLOSED for a homescoop issue. */
async function issueState(n) {
  if (fixtures) return String(fixtures.issues?.[n] ?? 'OPEN').toUpperCase();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/ai-ecoverse/homescoop/issues/${n}`, {
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub issue #${n}: HTTP ${res.status}`);
  return String((await res.json()).state).toUpperCase();
}

/** true / false from scripts/cert-review/repack-input.mjs; null when the trace couldn't run. */
function chainAttested(name) {
  if (fixtures) return fixtures.attested?.[name] ?? false;
  const r = spawnSync(process.execPath, [join(root, 'scripts/cert-review/repack-input.mjs'), '--package', name], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status === 2 || r.status === null) return null;
  try {
    return JSON.parse(r.stdout).attested === true;
  } catch {
    return null;
  }
}

/** Errors for an allowlist entry that has outlived its fix. */
async function staleEntry(name, entry, mismatches) {
  const out = [];
  if (!mismatches.length) out.push('its pins now match');
  if ((await issueState(entry.issue)) !== 'OPEN') out.push(`#${entry.issue} is closed`);
  const attested = chainAttested(name);
  if (attested === true) out.push('its repack chain is now attested (scripts/cert-review/repack-input.mjs)');
  if (attested === null) console.log(`::warning::${name}: repack-input.mjs could not trace the chain; attestation not checked`);
  return out;
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
      // Packaging-only repack of a published tarball: nothing fetches the
      // source, so recipe-sha verifies it and never rewrites it (#730).
      if (!verifyRepack) {
        console.log(`skip ${name}: repack of ${recipe.repack.from} (pins verified with --verify-repack)`);
        continue;
      }
      const entry = allowlist.get(name);
      if (entry) {
        const mismatches = [];
        refreshOne(name, { check: true, mismatches });
        const stale = await staleEntry(name, entry, mismatches);
        if (stale.length) {
          throw new Error(
            `${name}: scripts/recipe-sha-allowlist.txt entry "${entry.line}" is stale: ${stale.join('; ')}. ` +
              'Drop the entry (and fix any pin that still mismatches).'
          );
        }
        console.log(`known ${name}: repack of ${recipe.repack.from}, allowlisted (${entry.line}): ${mismatches.join('; ')}`);
        continue;
      }
      console.log(`verify ${name}: repack of ${recipe.repack.from}`);
      refreshOne(name, {
        check: true,
        why:
          'This recipe is a repack, so no build fetches its source and nothing else checks the pin. ' +
          'Record the source the repacked bytes were really built from (or drop repack: and rebuild).',
      });
      continue;
    }
    if (allowlist.has(name)) {
      console.log(`::warning::${name} is in scripts/recipe-sha-allowlist.txt but is not a repack; drop the entry`);
    }
    if (!recipe.source?.url || recipe.source.url === null) {
      console.log(`skip ${name}: null source`);
      continue;
    }
    refreshOne(name);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    say('recipe-sha', false, `${name}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200)}`);
    process.exit(1);
  }
}
say('recipe-sha', true, `${names.length} recipe${names.length === 1 ? '' : 's'}${checkOnly ? ' checked' : ''}${verifyRepack ? ', repacks verified' : ''}`);
