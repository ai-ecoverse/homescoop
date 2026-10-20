import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biosPins, catalogPins } from '../browser-cert/compat.mjs';

const SHA = 'b'.repeat(40);
const lock = (pins) => ({ packages: Object.fromEntries(Object.entries(pins).map(([n, v]) => [`node_modules/${n}`, { version: v, integrity: `sha512-${n}-${v}` }])) });
const BASE = { pkg: { dependencies: { '@ai-ecoverse/wasm-bash': '5.3.0-21' } }, lock: lock({ '@ai-ecoverse/wasm-bash': '5.3.0-21' }) };

function ghFor(tree) {
  return async (path) => {
    if (path.includes('/commits/')) return { sha: SHA };
    const m = /\/contents\/(.+)\?ref=/.exec(path);
    if (!m || !(m[1] in tree)) throw new Error(`GET https://api.github.com/${path}: 404 {"message":"Not Found"}`);
    return JSON.stringify(tree[m[1]]);
  };
}

const REGISTRY = {
  '@ai-ecoverse/wasm-git': { latest: '2.55.0-17', versions: ['2.55.0-16', '2.55.0-17'] },
  '@ai-ecoverse/wasm-zip': { latest: '3.0.0-7', versions: ['3.0.0-6', '3.0.0-7'] },
  '@ai-ecoverse/wasix-python': { latest: '3.15.0-4', versions: ['3.14.2-27', '3.14.2-28', '3.15.0-3', '3.15.0-4'] },
};
const asked = [];
function view(spec) {
  asked.push(spec);
  const at = spec.lastIndexOf('@');
  const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, null];
  const r = REGISTRY[name];
  if (!r) throw new Error(`npm view ${spec}: E404`);
  const v = version || r.latest;
  return { name, version: v, 'dist-tags': { latest: r.latest }, versions: r.versions, dist: { integrity: `sha512-${name}-${v}` } };
}

test('the old shape: optional/package.json and its lock pin the catalog', async () => {
  const bios = await biosPins('main', {
    gh: ghFor({
      'src/packages/package.json': BASE.pkg,
      'src/packages/package-lock.json': BASE.lock,
      'src/packages/optional/package.json': { dependencies: { '@ai-ecoverse/wasm-zip': '3.0.0-6' } },
      'src/packages/optional/package-lock.json': lock({ '@ai-ecoverse/wasm-zip': '3.0.0-6' }),
    }),
    view: () => assert.fail('the old shape needs no registry'),
  });
  assert.equal(bios.sha, SHA);
  assert.deepEqual(bios.base, [{ name: '@ai-ecoverse/wasm-bash', version: '5.3.0-21', integrity: 'sha512-@ai-ecoverse/wasm-bash-5.3.0-21' }]);
  assert.deepEqual(bios.catalog, [{ name: '@ai-ecoverse/wasm-zip', version: '3.0.0-6', integrity: 'sha512-@ai-ecoverse/wasm-zip-3.0.0-6' }]);
  assert.ok(bios.files.includes('src/packages/optional/package-lock.json'));
});

test('catalog.json: its keys at npm latest, no projects, wasix-python at the highest X.Y.Z its range allows', async () => {
  const catalog = {
    '@ai-ecoverse/wasm-git': { id: 'git', label: 'git' },
    '@ai-ecoverse/wasix-python': { id: 'python', label: 'Python', range: '>=3.14.0 <3.15.0' },
    'slicc-py-datatools': { id: 'pydata', kind: 'project', label: 'Python data tools' },
    '@ai-ecoverse/wasm-zip': { id: 'zip', label: 'zip' },
  };
  const bios = await biosPins('main', {
    gh: ghFor({ 'src/packages/package.json': BASE.pkg, 'src/packages/package-lock.json': BASE.lock, 'src/packages/optional/catalog.json': catalog }),
    view,
  });
  assert.deepEqual(bios.catalog, [
    { name: '@ai-ecoverse/wasix-python', version: '3.14.2-28', integrity: 'sha512-@ai-ecoverse/wasix-python-3.14.2-28' },
    { name: '@ai-ecoverse/wasm-git', version: '2.55.0-17', integrity: 'sha512-@ai-ecoverse/wasm-git-2.55.0-17' },
    { name: '@ai-ecoverse/wasm-zip', version: '3.0.0-7', integrity: 'sha512-@ai-ecoverse/wasm-zip-3.0.0-7' },
  ]);
  assert.ok(!asked.some((s) => s.startsWith('slicc-py-datatools')), 'a project entry is not looked up');
  assert.deepEqual(bios.files, ['src/packages/package.json', 'src/packages/package-lock.json', 'src/packages/optional/catalog.json']);
  assert.equal(bios.base.length, 1, 'the base set is unchanged');
});

test('catalog.json: a range nothing satisfies fails the plan', () => {
  assert.throws(() => catalogPins({ '@ai-ecoverse/wasix-python': { range: '>=3.16.0 <3.17.0' } }, view), /no published version satisfies range >=3\.16\.0 <3\.17\.0/);
});

test('another error than a 404 for optional/package.json is not read as the new shape', async () => {
  const gh = async (path) => {
    if (path.includes('/commits/')) return { sha: SHA };
    if (path.includes('optional/package.json')) throw new Error(`GET https://api.github.com/${path}: 403 {"message":"rate limit"}`);
    if (path.includes('src/packages/package.json')) return JSON.stringify(BASE.pkg);
    return JSON.stringify(BASE.lock);
  };
  await assert.rejects(biosPins('main', { gh, view }), /403/);
});
