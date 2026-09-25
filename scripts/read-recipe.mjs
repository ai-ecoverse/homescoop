#!/usr/bin/env node
/**
 * Read homescoop recipe.yaml fields (small YAML subset, no dependency).
 *
 *   node scripts/read-recipe.mjs zlib --json
 *   node scripts/read-recipe.mjs zlib --deps
 *   node scripts/read-recipe.mjs zlib --field version
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const mode = process.argv[3] || '--json';
const field = process.argv[4];

if (!name || name.startsWith('-')) {
  console.error('usage: read-recipe.mjs <package> [--json|--deps|--field <key>]');
  process.exit(2);
}

const path = join(root, 'packages', name, 'recipe.yaml');
if (!existsSync(path)) {
  console.error(`missing ${path}`);
  process.exit(1);
}

/**
 * Minimal YAML subset: 2-space indent, scalars, null, [], maps, `- item` lists.
 * Empty nested keys are maps; use `key: []` for empty lists.
 * @param {string} text
 */
function parseSimpleYaml(text) {
  /** @type {Record<string, unknown>} */
  const rootObj = {};
  /** @type {{ indent: number, container: Record<string, unknown> | unknown[] }[]} */
  const stack = [{ indent: -1, container: rootObj }];

  const unquote = (s) => {
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      return s.slice(1, -1);
    }
    return s;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      if (!Array.isArray(top.container)) {
        console.error(`list item under non-list at indent ${indent}: ${line}`);
        process.exit(1);
      }
      top.container.push(unquote(line.slice(2).trim()));
      continue;
    }

    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    if (Array.isArray(top.container)) {
      console.error(`map key under list: ${line}`);
      process.exit(1);
    }
    const key = m[1];
    const rest = m[2];
    const parent = /** @type {Record<string, unknown>} */ (top.container);

    if (rest === '[]') {
      parent[key] = [];
      continue;
    }
    if (rest === 'null' || rest === '~') {
      parent[key] = null;
      continue;
    }
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, container: child });
      continue;
    }
    parent[key] = unquote(rest);
  }

  return rootObj;
}

const recipe = parseSimpleYaml(readFileSync(path, 'utf8'));

if (mode === '--json') {
  console.log(JSON.stringify(recipe, null, 2));
  process.exit(0);
}

if (mode === '--field') {
  if (!field) {
    console.error('--field requires a key');
    process.exit(2);
  }
  const parts = field.split('.');
  let cur = /** @type {unknown} */ (recipe);
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') {
      cur = undefined;
      break;
    }
    cur = /** @type {Record<string, unknown>} */ (cur)[p];
  }
  if (cur === undefined || cur === null) process.exit(0);
  if (typeof cur === 'object') console.log(JSON.stringify(cur));
  else console.log(String(cur));
  process.exit(0);
}

if (mode === '--deps') {
  const deps = /** @type {Record<string, unknown>} */ (recipe.dependencies || {});
  for (const k of ['build', 'host', 'run']) {
    const arr = deps[k];
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (typeof s === 'string' && s.trim()) console.log(s.trim());
    }
  }
  process.exit(0);
}

console.error(`unknown mode ${mode}`);
process.exit(2);
