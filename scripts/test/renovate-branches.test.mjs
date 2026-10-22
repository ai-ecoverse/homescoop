// Renovate names an update's branch renovate/<additionalBranchPrefix><depNameSanitized>-<major>.x,
// and updates that land on the same branch become one PR, which automerges only if every
// update in it does. The github-actions pin ai-ecoverse/slicc-shared-web (the workflow's
// pipeline, manual: publish path) and the npm devDependency @ai-ecoverse/slicc-shared-web (automerge)
// sanitize to the same name, so they shared renovate/ai-ecoverse-slicc-shared-web-1.x and
// #1270 never automerged. This check models that naming for every dependency the repo's
// managers read and fails when two managers would share a branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

// Renovate's sanitizeDepName (lib/workers/repository/updates/flatten.ts).
export function sanitize(depName) {
  return depName
    .replace('@types/', '')
    .replace('@', '')
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/:/g, '-')
    .replace(/-+/, '-')
    .toLowerCase();
}

function ignored(path) {
  return (renovate.ignorePaths || []).some((p) => {
    const inner = p.match(/^\*\*\/([^*/]+)\/\*\*$/);
    if (inner) return path.split('/').slice(0, -1).includes(inner[1]);
    const prefix = p.match(/^([^*]+)\/\*\*$/);
    if (prefix) return path.startsWith(`${prefix[1]}/`);
    throw new Error(`renovate-branches: ignorePaths pattern ${p} is not modelled; teach this test`);
  });
}

function deps() {
  const out = [];
  for (const file of files.filter((f) => /(^|\/)package\.json$/.test(f) && !ignored(f))) {
    const m = JSON.parse(readFileSync(join(root, file), 'utf8'));
    for (const type of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(m[type] || {})) out.push({ manager: 'npm', depName: name, file });
    }
  }
  const workflow = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /(^|\/)action\.ya?ml$/.test(f);
  for (const file of files.filter((f) => workflow(f) && !ignored(f))) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, ref] of text.matchAll(/^\s*-?\s*uses:\s*['"]?([^\s'"#]+)/gm)) {
      if (ref.startsWith('./') || ref.startsWith('docker://') || !ref.includes('@')) continue;
      const [owner, repo] = ref.split('@')[0].split('/');
      out.push({ manager: 'github-actions', depName: `${owner}/${repo}`, file });
    }
  }
  for (const m of renovate.customManagers || []) {
    const patterns = m.managerFilePatterns.map((p) => new RegExp(p.slice(1, -1)));
    for (const file of files.filter((f) => patterns.some((p) => p.test(f)) && !ignored(f))) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const s of m.matchStrings) {
        for (const g of text.matchAll(new RegExp(s, 'g'))) {
          const depName = g.groups.depName || g.groups.datasource;
          out.push({ manager: 'regex', depName, file });
        }
      }
    }
  }
  return out;
}

// additionalBranchPrefix from the packageRules that apply to every update of a manager
// and dependency. A rule with any other match* key is not modelled, so it never counts.
function prefixOf(rules, { manager, depName }) {
  let prefix = '';
  for (const r of rules) {
    if (!('additionalBranchPrefix' in r)) continue;
    const keys = Object.keys(r).filter((k) => k.startsWith('match'));
    if (keys.some((k) => !['matchManagers', 'matchDepNames', 'matchPackageNames'].includes(k))) continue;
    if (r.matchManagers && !r.matchManagers.includes(manager)) continue;
    if (r.matchDepNames && !r.matchDepNames.includes(depName)) continue;
    if (r.matchPackageNames && !r.matchPackageNames.includes(depName)) continue;
    prefix = r.additionalBranchPrefix;
  }
  return prefix;
}

function collisions(rules) {
  const byBranch = new Map();
  for (const d of deps()) {
    const branch = `${prefixOf(rules, d)}${sanitize(d.depName)}`;
    if (!byBranch.has(branch)) byBranch.set(branch, new Map());
    byBranch.get(branch).set(d.manager, d);
  }
  return [...byBranch]
    .filter(([, managers]) => managers.size > 1)
    .map(([branch, managers]) => `renovate/${branch}-<major>.x: ${[...managers.values()].map((d) => `${d.manager} ${d.depName} (${d.file})`).join(' + ')}`);
}

test('no two Renovate managers share a branch (one PR, one automerge decision)', () => {
  const found = collisions(renovate.packageRules || []);
  console.log(found.length ? `renovate-branches: FAIL ${found.length} shared branch(es)` : 'renovate-branches: PASS no shared branches');
  assert.deepEqual(found, [], `updates from different managers would share a branch:\n${found.join('\n')}`);
});

test('without the actions- prefix, the slicc-shared-web action and devDependency share a branch (#1270)', () => {
  const rules = (renovate.packageRules || []).filter((r) => !('additionalBranchPrefix' in r));
  const found = collisions(rules);
  assert.ok(
    found.some((c) => c.startsWith('renovate/ai-ecoverse-slicc-shared-web-<major>.x:') && c.includes('npm @ai-ecoverse/slicc-shared-web') && c.includes('github-actions ai-ecoverse/slicc-shared-web')),
    `the model no longer sees the #1270 collision:\n${found.join('\n')}`,
  );
});

test('sanitize matches Renovate on the names that collided', () => {
  assert.equal(sanitize('@ai-ecoverse/slicc-shared-web'), 'ai-ecoverse-slicc-shared-web');
  assert.equal(sanitize('ai-ecoverse/slicc-shared-web'), 'ai-ecoverse-slicc-shared-web');
  assert.equal(sanitize('@types/node'), 'node');
});
