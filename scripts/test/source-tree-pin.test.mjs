// Every GitHub archive of a commit used as a recipe source pins its content with
// `tree:` (#1267): GitHub's generated archive bytes are not stable, the tree is.
// scripts/source-tree-allowlist.txt lists today's sources without one; stale entries fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubArchive } from '../source-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources() {
  const out = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    if (!existsSync(join(root, 'packages', name, 'recipe.yaml'))) continue;
    const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const recipe = JSON.parse(r.stdout);
    if (recipe.builder === 'retired') continue;
    const jobs = [];
    if (recipe.source?.url) jobs.push(['source', recipe.source]);
    for (const [k, v] of Object.entries(recipe.sources || {})) if (v && typeof v === 'object' && v.url) jobs.push([`sources.${k}`, v]);
    for (const [label, src] of jobs) {
      if (!githubArchive(String(src.url))) continue;
      out.push({ id: label === 'source' ? name : `${name}/${label}`, tree: src.tree ? String(src.tree) : '' });
    }
  }
  return out;
}

function allowlist() {
  const path = join(root, 'scripts/source-tree-allowlist.txt');
  const out = new Map();
  for (const [i, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+#(\d+)\s+\S/);
    assert.ok(m, `source-tree-allowlist.txt:${i + 1}: want "<package>[/sources.<key>] #<issue> <reason>", got "${line}"`);
    out.set(m[1], line);
  }
  return out;
}

test('every GitHub commit archive source pins source.tree, or is allowlisted with its issue', () => {
  const allow = allowlist();
  const all = sources();
  const missing = all.filter((s) => !s.tree && !allow.has(s.id)).map((s) => s.id);
  assert.deepEqual(missing, [], `add tree: (the commit's git tree sha) to: ${missing.join(', ')}`);
  for (const s of all) if (s.tree) assert.match(s.tree, /^[0-9a-f]{40}$/, `${s.id}: tree must be 40 hex`);
  const unpinned = new Set(all.filter((s) => !s.tree).map((s) => s.id));
  const stale = [...allow.keys()].filter((id) => !unpinned.has(id));
  assert.deepEqual(stale, [], `stale scripts/source-tree-allowlist.txt entries (pinned now, or not a GitHub commit archive): ${stale.join(', ')}`);
});
