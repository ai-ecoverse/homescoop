import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const matcher = (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

function workspaceDirs(patterns, dirs) {
  return dirs.filter((dir) => {
    let included = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      if (matcher(negated ? pattern.slice(1) : pattern).test(dir)) included = !negated;
    }
    return included;
  });
}

const packageDirs = readdirSync(join(root, 'packages'))
  .map((name) => `packages/${name}/package`)
  .filter((dir) => existsSync(join(root, dir, 'package.json')));

test('every packages/*3.15 npm-tag variant is left out of the root workspaces (#1193)', () => {
  const variants = packageDirs.filter((dir) => /^packages\/[^/]*3\.15\/package$/.test(dir));
  // Between waves (after the fold) there is none, and no exclusion either.
  if (!variants.length) {
    assert.ok(!rootJson.workspaces.some((w) => /^!packages\/\*3\.15\//.test(w)), 'no packages/*3.15 dir left: drop the root workspaces exclusion');
    return;
  }
  const included = workspaceDirs(rootJson.workspaces, variants);
  assert.deepEqual(included, [], `root package.json workspaces include ${included.join(', ')}`);
});

test('root workspace package names are unique, so npm ci in a test/ dir resolves (#1193)', () => {
  const seen = new Map();
  for (const dir of workspaceDirs(rootJson.workspaces, packageDirs)) {
    const { name } = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
    if (!name) continue;
    assert.ok(!seen.has(name), `${name} is the workspace name of both ${seen.get(name)} and ${dir}`);
    seen.set(name, dir);
  }
  assert.ok(seen.size > 100, `only ${seen.size} workspaces found`);
});

test('a later negation wins over the include, as in npm', () => {
  assert.deepEqual(workspaceDirs(['packages/*/package', '!packages/*3.15/package'], ['packages/a/package', 'packages/a3.15/package']), ['packages/a/package']);
  assert.deepEqual(workspaceDirs(['packages/*/package'], ['packages/a3.15/package']), ['packages/a3.15/package']);
});
