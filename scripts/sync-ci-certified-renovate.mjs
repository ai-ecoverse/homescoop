#!/usr/bin/env node
/**
 * Sync scripts/ci-certified.json → renovate.json matchFileNames for the
 * CI-certified automerge rule, and every `builder: retired` recipe → the rule
 * that turns Renovate off for it (retired recipes are built, if at all, by
 * their own workflows from pinned sources; a recipe bump would build nothing).
 * Run after adding a package to ci-certified.json or retiring a recipe.
 *
 *   node scripts/sync-ci-certified-renovate.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certified = JSON.parse(readFileSync(join(root, 'scripts/ci-certified.json'), 'utf8'));
const renovatePath = join(root, 'renovate.json');
const renovate = JSON.parse(readFileSync(renovatePath, 'utf8'));

const files = (certified.packages || []).map((p) => `packages/${p}/recipe.yaml`);
const rule = renovate.packageRules.find((r) =>
  String(r.description || '').includes('CI-certified packages'),
);
if (!rule) {
  console.error('renovate.json missing CI-certified packageRule');
  process.exit(1);
}
rule.matchFileNames = files.length ? files : ['packages/.ci-certified-none/recipe.yaml'];
renovate.platformAutomerge = files.length > 0;

const retired = readdirSync(join(root, 'packages'))
  .filter((p) => {
    const f = join(root, 'packages', p, 'recipe.yaml');
    return existsSync(f) && /^builder:\s*["']?retired["']?\s*$/m.test(readFileSync(f, 'utf8'));
  })
  .sort()
  .map((p) => `packages/${p}/recipe.yaml`);
const RETIRED = 'Retired recipes (builder: retired)';
renovate.packageRules = renovate.packageRules.filter(
  (r) => !String(r.description || '').startsWith(RETIRED),
);
if (retired.length) {
  renovate.packageRules.push({
    description: `${RETIRED}: no Renovate PRs. They are built, if at all, by their own workflows from pinned sources (e.g. wasi-rustc-stable.yml), so a recipe bump builds nothing. Synced by scripts/sync-ci-certified-renovate.mjs.`,
    matchFileNames: retired,
    enabled: false,
  });
}
writeFileSync(renovatePath, `${JSON.stringify(renovate, null, 2)}\n`);
console.log(
  files.length
    ? `automerge enabled for: ${certified.packages.join(', ')}`
    : 'no CI-certified packages — platformAutomerge false',
);
console.log(`Renovate off for retired: ${retired.map((f) => f.split('/')[1]).join(', ') || '(none)'}`);
