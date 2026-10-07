#!/usr/bin/env node
/**
 * Sync scripts/ci-certified.json → renovate.json matchFileNames for the
 * CI-certified automerge rule. Run after adding a package to ci-certified.json.
 *
 *   node scripts/sync-ci-certified-renovate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
writeFileSync(renovatePath, `${JSON.stringify(renovate, null, 2)}\n`);
console.log(
  files.length
    ? `automerge enabled for: ${certified.packages.join(', ')}`
    : 'no CI-certified packages — platformAutomerge false',
);
