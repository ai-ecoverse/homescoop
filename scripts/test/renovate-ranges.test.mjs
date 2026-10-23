import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
const before = JSON.parse(readFileSync(join(root, 'scripts/test/fixtures/renovate/main-b3c71d32.json'), 'utf8'));
const mainBeforeMemoryPeak = JSON.parse(readFileSync(join(root, 'scripts/test/fixtures/renovate/main-84494621.json'), 'utf8'));

const PRESET_NPM_RANGE_STRATEGY = 'pin';
const MODELLED = new Set([
  'matchManagers',
  'matchFileNames',
  'matchPackageNames',
  'matchDepNames',
  'matchUpdateTypes',
  'matchCurrentValue',
  'matchDatasources',
  'matchDepTypes',
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
  if (rule.matchDatasources && !rule.matchDatasources.includes(dep.datasource ?? 'npm')) return false;
  if (rule.matchDepTypes && !rule.matchDepTypes.includes(dep.depType)) return false;
  if (rule.matchFileNames && !rule.matchFileNames.some((p) => glob(p).test(dep.file))) return false;
  if (rule.matchPackageNames && !matchList(rule.matchPackageNames, dep.name)) return false;
  if (rule.matchDepNames && !matchList(rule.matchDepNames, dep.name)) return false;
  if (rule.matchUpdateTypes && !rule.matchUpdateTypes.includes(dep.updateType)) return false;
  if (rule.matchCurrentValue && !pattern(rule.matchCurrentValue).test(dep.value)) return false;
  return true;
}

function resolve(dep, config = renovate) {
  let rangeStrategy = PRESET_NPM_RANGE_STRATEGY;
  let automerge = true;
  let enabled = true;
  for (const rule of config.packageRules) {
    if (!matches(rule, dep)) continue;
    if ('rangeStrategy' in rule) rangeStrategy = rule.rangeStrategy;
    if ('automerge' in rule) automerge = rule.automerge;
    if ('enabled' in rule) enabled = rule.enabled;
  }
  return { rangeStrategy, automerge, enabled };
}

const UPDATE_TYPES = ['patch', 'minor', 'major', 'pin', 'bump'];

function updated(config) {
  const out = [];
  for (const d of deps.filter((x) => x.name.startsWith('@ai-ecoverse/'))) {
    for (const updateType of UPDATE_TYPES) {
      if (resolve({ ...d, updateType }, config).enabled) out.push(`${d.file} ${d.name} ${d.value} ${updateType}`);
    }
  }
  return out;
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

const ours = deps.filter((d) => d.name.startsWith('@ai-ecoverse/'));
const others = deps.filter((d) => !d.name.startsWith('@ai-ecoverse/'));

test('the shipped manifests have exact @ai-ecoverse pins, >= < ranges and other dependencies to check', () => {
  assert.ok(pins.length > 0, 'no exact @ai-ecoverse pin in packages/*/package/package.json');
  assert.ok(ranges.length > 0, 'no >= < range in packages/*/package/package.json');
  assert.ok(others.length > 0, 'no non-@ai-ecoverse dependency in packages/*/package/package.json');
});

test('Renovate never updates an @ai-ecoverse dependency in a shipped manifest: a re-pin without a new -N fails npm-parity', () => {
  assert.deepEqual(updated(renovate), []);
});

const CLOSED = [
  ['wasm-clang', '@ai-ecoverse/wasix-sysroot', 1702],
  ['wasm-clang', '@ai-ecoverse/wasm-binaryen', 1703],
  ['wasm-emscripten', '@ai-ecoverse/wasm-binaryen', 1703],
  ['wasm-emscripten', '@ai-ecoverse/wasm-clang', 1707],
  ['xz', '@ai-ecoverse/wasm-coreutils', 1708],
  ['wasi-uv', '@ai-ecoverse/wasix-python', 1709],
];

test('NEGATIVE: main\'s renovate.json before this change lets the closed re-pins through, and this one does not', () => {
  assert.ok(updated(before).length > 0);
  for (const [pkg, name, pr] of CLOSED) {
    const file = `packages/${pkg}/package/package.json`;
    const d = deps.find((x) => x.file === file && x.name === name);
    assert.ok(d, `#${pr}: ${file} no longer depends on ${name}`);
    const old = resolve({ ...d, updateType: 'patch' }, before);
    assert.equal(old.enabled, true, `#${pr} ${file} ${name}`);
    assert.equal(old.automerge, true, `#${pr} ${file} ${name}`);
    assert.equal(resolve({ ...d, updateType: 'patch' }).enabled, false, `#${pr} ${file} ${name}`);
  }
});

test('the other dependencies of a shipped manifest never get the shared preset\'s pin (#1700): rangeStrategy is replace', () => {
  for (const d of others) {
    for (const updateType of ['patch', 'minor', 'major']) {
      assert.equal(resolve({ ...d, updateType }).rangeStrategy, 'replace', `${d.file} ${d.name} ${d.value}`);
    }
  }
});

test('the root package.json devDependencies keep updating with the shared preset\'s pin and automerge', () => {
  const m = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const names = Object.keys(m.devDependencies || {}).filter((n) => n !== 'slicc-kernel-negative');
  assert.ok(names.some((n) => n.startsWith('@ai-ecoverse/')), 'no @ai-ecoverse devDependency in the root package.json');
  for (const name of names) {
    for (const updateType of ['patch', 'minor']) {
      const r = resolve({ manager: 'npm', file: 'package.json', name, value: m.devDependencies[name], updateType });
      assert.equal(r.enabled, true, `${name} ${updateType}`);
      assert.equal(r.rangeStrategy, PRESET_NPM_RANGE_STRATEGY, name);
      assert.equal(r.automerge, true, `${name} ${updateType}`);
    }
  }
});

const LADDER_BUILD = '.github/workflows/ladder-build.yml';
const MEMORY_PEAK = 'ai-ecoverse/slicc-shared-web/.github/actions/memory-peak';
const PIPELINE = 'ai-ecoverse/slicc-shared-web/.github/workflows/pipeline.yml';

function workflowDeps() {
  const out = [];
  for (const name of readdirSync(join(root, '.github/workflows')).filter((f) => /^ladder-.*\.ya?ml$/.test(f)).sort()) {
    const file = `.github/workflows/${name}`;
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, ref] of text.matchAll(/^\s*-?\s*uses:\s*['"]?([^\s'"#]+)/gm)) {
      if (ref.startsWith('./') || ref.startsWith('docker://') || !ref.includes('@')) continue;
      const [target, value] = ref.split('@');
      const [owner, repo, ...rest] = target.split('/');
      const path = rest.join('/');
      const depType = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ? 'workflow' : 'action';
      out.push({ manager: 'github-actions', datasource: 'github-tags', file, name: `${owner}/${repo}`, target, value, depType });
    }
  }
  return out;
}

const actions = workflowDeps();
const memoryPeak = actions.filter((d) => d.target === MEMORY_PEAK);
const pipeline = actions.filter((d) => d.target === PIPELINE);

function branchAutomerges(updates, config) {
  return updates.every((u) => resolve(u, config).automerge);
}

test('ladder-build.yml has memory-peak steps and the pipeline.yml pin, both named ai-ecoverse/slicc-shared-web', () => {
  assert.ok(memoryPeak.length > 0, `no ${MEMORY_PEAK} step in ${LADDER_BUILD}`);
  assert.ok(memoryPeak.every((d) => d.file === LADDER_BUILD && d.depType === 'action' && d.name === 'ai-ecoverse/slicc-shared-web'));
  assert.equal(pipeline.length, 1, `${PIPELINE} pin in ${LADDER_BUILD}`);
  assert.equal(pipeline[0].depType, 'workflow');
  assert.equal(pipeline[0].name, 'ai-ecoverse/slicc-shared-web');
});

test('memory-peak minors and patches automerge; its majors stay manual', () => {
  for (const d of memoryPeak) {
    for (const updateType of ['minor', 'patch']) {
      const r = resolve({ ...d, updateType });
      assert.equal(r.enabled, true, `${d.target}@${d.value} ${updateType}`);
      assert.equal(r.automerge, true, `${d.target}@${d.value} ${updateType}`);
    }
    assert.equal(resolve({ ...d, updateType: 'major' }).automerge, false, `${d.target}@${d.value} major`);
    assert.equal(resolve({ ...d, updateType: 'digest' }).automerge, false, `${d.target}@${d.value} digest`);
  }
});

test('every other action and pin in the ladder workflows stays manual, the pipeline.yml pin included', () => {
  const others = actions.filter((d) => d.target !== MEMORY_PEAK);
  assert.ok(others.some((d) => d.target === PIPELINE));
  assert.ok(others.some((d) => d.name === 'actions/checkout'));
  const armed = [];
  for (const d of others) {
    for (const updateType of ['patch', 'minor', 'major', 'digest']) {
      if (resolve({ ...d, updateType }).automerge) armed.push(`${d.file} ${d.target}@${d.value} ${updateType}`);
    }
  }
  assert.deepEqual(armed, []);
});

test('the slicc-shared-web group branch stays manual when it also moves the pipeline.yml pin', () => {
  for (const updateType of ['minor', 'patch']) {
    assert.equal(branchAutomerges(memoryPeak.map((d) => ({ ...d, updateType })), renovate), true, updateType);
    assert.equal(branchAutomerges([...memoryPeak, ...pipeline].map((d) => ({ ...d, updateType })), renovate), false, updateType);
  }
});

test('NEGATIVE: main\'s renovate.json before this change leaves memory-peak manual (#1715, #1734, #1742, #1745, #1753), and the pipeline.yml pin stays manual on both', () => {
  for (const d of memoryPeak) {
    for (const updateType of ['minor', 'patch']) {
      assert.equal(resolve({ ...d, updateType }, mainBeforeMemoryPeak).automerge, false, `${d.target}@${d.value} ${updateType}`);
      assert.equal(resolve({ ...d, updateType }).automerge, true, `${d.target}@${d.value} ${updateType}`);
    }
  }
  for (const d of pipeline) {
    for (const updateType of ['minor', 'patch']) {
      assert.equal(resolve({ ...d, updateType }, mainBeforeMemoryPeak).automerge, false, `${d.target}@${d.value} ${updateType}`);
      assert.equal(resolve({ ...d, updateType }).automerge, false, `${d.target}@${d.value} ${updateType}`);
    }
  }
});
