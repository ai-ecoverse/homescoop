import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));

const PRESET_NPM_RANGE_STRATEGY = 'pin';
const MODELLED = new Set([
  'matchManagers',
  'matchFileNames',
  'matchPackageNames',
  'matchDepNames',
  'matchUpdateTypes',
  'matchCurrentValue',
  'matchDatasources',
]);

function glob(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '{' || c === '}') re += c === '{' ? '(?:' : ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function pattern(p) {
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) return new RegExp(p.slice(1, -1));
  return glob(p);
}

function matchList(list, value) {
  const neg = list.filter((p) => p.startsWith('!')).map((p) => pattern(p.slice(1)));
  const pos = list.filter((p) => !p.startsWith('!')).map(pattern);
  if (neg.some((r) => r.test(value))) return false;
  return pos.length === 0 || pos.some((r) => r.test(value));
}

function matches(rule, dep) {
  for (const key of Object.keys(rule).filter((k) => k.startsWith('match'))) {
    if (!MODELLED.has(key)) throw new Error(`renovate-ranges: ${key} is not modelled; teach this test`);
  }
  if (rule.matchManagers && !rule.matchManagers.includes(dep.manager)) return false;
  if (rule.matchDatasources && !rule.matchDatasources.includes('npm')) return false;
  if (rule.matchFileNames && !rule.matchFileNames.some((p) => glob(p).test(dep.file))) return false;
  if (rule.matchPackageNames && !matchList(rule.matchPackageNames, dep.name)) return false;
  if (rule.matchDepNames && !matchList(rule.matchDepNames, dep.name)) return false;
  if (rule.matchUpdateTypes && !rule.matchUpdateTypes.includes(dep.updateType)) return false;
  if (rule.matchCurrentValue && !pattern(rule.matchCurrentValue).test(dep.value)) return false;
  return true;
}

function resolve(dep) {
  let rangeStrategy = PRESET_NPM_RANGE_STRATEGY;
  let automerge = true;
  for (const rule of renovate.packageRules) {
    if (!matches(rule, dep)) continue;
    if ('rangeStrategy' in rule) rangeStrategy = rule.rangeStrategy;
    if ('automerge' in rule) automerge = rule.automerge;
  }
  return { rangeStrategy, automerge };
}

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function shipped() {
  const out = [];
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    const file = `packages/${dir}/package/package.json`;
    if (!existsSync(join(root, file))) continue;
    const m = JSON.parse(readFileSync(join(root, file), 'utf8'));
    for (const type of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, value] of Object.entries(m[type] || {})) out.push({ manager: 'npm', file, name, value });
    }
  }
  return out;
}

const deps = shipped();
const ranges = deps.filter((d) => /^>=\S+ <\S+$/.test(d.value));
const pins = deps.filter((d) => d.name.startsWith('@ai-ecoverse/') && EXACT.test(d.value));

test('the shipped manifests have both >= < ranges and exact @ai-ecoverse pins to check', () => {
  assert.ok(ranges.length > 0, 'no >= < range in packages/*/package/package.json');
  assert.ok(pins.length > 0, 'no exact @ai-ecoverse pin in packages/*/package/package.json');
});

test('no shipped manifest dependency gets the shared preset\'s pin (#1700): rangeStrategy is replace', () => {
  for (const d of deps) {
    for (const updateType of ['patch', 'minor', 'major']) {
      assert.equal(resolve({ ...d, updateType }).rangeStrategy, 'replace', `${d.file} ${d.name} ${d.value}`);
    }
  }
});

test('a >= < range is only rewritten when a version falls outside it, so that PR never automerges', () => {
  for (const d of ranges) {
    for (const updateType of ['patch', 'minor']) {
      assert.equal(resolve({ ...d, updateType }).automerge, false, `${d.file} ${d.name} ${d.value} ${updateType}`);
    }
  }
});

test('an exact @ai-ecoverse pin in a shipped manifest still bumps and automerges below a major', () => {
  for (const d of pins) {
    for (const updateType of ['patch', 'minor']) {
      const r = resolve({ ...d, updateType });
      assert.equal(r.rangeStrategy, 'replace', `${d.file} ${d.name}`);
      assert.equal(r.automerge, true, `${d.file} ${d.name} ${updateType}`);
    }
    assert.equal(resolve({ ...d, updateType: 'major' }).automerge, false, `${d.file} ${d.name} major`);
  }
});

test('the root package.json devDependencies keep the shared preset\'s pin', () => {
  const m = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const names = Object.keys(m.devDependencies || {});
  assert.ok(names.length > 0);
  for (const name of names) {
    const r = resolve({ manager: 'npm', file: 'package.json', name, value: m.devDependencies[name], updateType: 'patch' });
    assert.equal(r.rangeStrategy, PRESET_NPM_RANGE_STRATEGY, name);
  }
});
