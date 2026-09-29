#!/usr/bin/env node
/**
 * Shared recipe status helpers for homescoop scripts.
 *
 * builder: retired → not listed, not built, not published.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name */
export function recipeBuilder(name) {
  const r = spawnSync(
    'node',
    [join(root, 'scripts/read-recipe.mjs'), name, '--field', 'builder'],
    { encoding: 'utf8', cwd: root }
  );
  return (r.stdout || '').trim() || 'slicc';
}

/** @param {string} name */
export function isRecipeRetired(name) {
  return recipeBuilder(name) === 'retired';
}

/** @param {string} name */
export function assertRecipeBuildable(name) {
  const b = recipeBuilder(name);
  if (b === 'retired') {
    console.error(
      `homescoop: package '${name}' is retired (builder: retired) — refuse build/publish`
    );
    process.exit(2);
  }
  return b;
}

/**
 * Packages that must be fully removed from npm (every published version),
 * independent of the semver plain/prerelease trap. Agents only print commands.
 */
export const REMOVE_ENTIRELY = [
  {
    npm: '@ai-ecoverse/wasm-ffmpeg',
    reason: 'remove-codec-distribution',
    detail:
      'remove entirely: codec distribution — SLICC owns ffmpeg; @ai-ecoverse must not ship MPEG codecs (Adobe / MPEG consortium)',
    // Historical versions (some already unpublished); always emit all known.
    knownVersions: ['5.1.10-1', '6.1.6', '6.1.6-1', '7.1.5'],
  },
];

/** @param {string} name package directory under packages/ */
export function hasRecipe(name) {
  return existsSync(join(root, 'packages', name, 'recipe.yaml'));
}
