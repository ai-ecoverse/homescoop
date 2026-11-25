import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourcePin, sourcePinErrors } from '../upstream-version-text.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(scripts, '..');
const OLD = '3e9473d248429bad874e848281f0e91ad6f41ea8';
const NEW = '23a945ddd734be70671c246f3c5a8a4fecfb3a42';

function recipe(name) {
  const r = spawnSync(process.execPath, [join(scripts, 'read-recipe.mjs'), name, '--json'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('every package.json homescoop.source names its recipe source.commit', () => {
  const checked = [];
  const problems = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const pj = join(root, 'packages', name, 'package', 'package.json');
    if (!existsSync(pj) || !existsSync(join(root, 'packages', name, 'recipe.yaml'))) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    if (pkg.homescoop?.source === undefined) continue;
    const r = recipe(name);
    if (r.builder === 'retired') continue;
    const commit = r.source?.commit;
    if (commit === undefined) continue;
    assert.match(String(commit), /^[0-9a-f]{40}$/, `packages/${name}/recipe.yaml: source.commit must be 40 hex`);
    checked.push(name);
    for (const e of sourcePinErrors({ name, commit, pkg })) problems.push(`packages/${name}: ${e}`);
  }
  assert.ok(checked.length > 0, 'no package.json carries homescoop.source with a recipe source.commit');
  assert.deepEqual(problems, [], `homescoop.source is stale:\n${problems.join('\n')}`);
});

test('sourcePin keeps the field\'s owner/repo and takes the recipe\'s commit', () => {
  assert.equal(sourcePin(NEW, `fastly/cli@${OLD}`), `fastly/cli@${NEW}`);
  assert.equal(sourcePin(NEW, `Fastly/fastly-cli@${OLD}`), `Fastly/fastly-cli@${NEW}`);
  assert.equal(sourcePin(NEW, `fastly/cli@${NEW}`), `fastly/cli@${NEW}`);
  assert.equal(sourcePin(NEW, 'fastly/cli'), `fastly/cli@${NEW}`);
  assert.equal(sourcePin(NEW, 'fastly/cli@v17.1.0'), `fastly/cli@${NEW}`);
  assert.equal(sourcePin(undefined, `fastly/cli@${OLD}`), null);
  assert.equal(sourcePin('', `fastly/cli@${OLD}`), null);
  assert.equal(sourcePin(NEW.slice(0, 7), `fastly/cli@${OLD}`), null);
  assert.equal(sourcePin(NEW.toUpperCase(), `fastly/cli@${OLD}`), null);
  assert.equal(sourcePin(NEW, undefined), null);
  assert.equal(sourcePin(NEW, { repo: 'fastly/cli' }), null);
});

test('sourcePinErrors fails a stale, short or foreign field, and passes a matching or absent one', () => {
  const errs = (source, commit = NEW) => sourcePinErrors({ name: 'wasi-fastly', commit, pkg: { homescoop: source === undefined ? {} : { source } } });
  assert.deepEqual(errs(`fastly/cli@${NEW}`), []);
  assert.deepEqual(errs(undefined), []);
  assert.deepEqual(sourcePinErrors({ name: 'wasi-fastly', commit: undefined, pkg: { homescoop: { source: `fastly/cli@${OLD}` } } }), []);
  assert.deepEqual(sourcePinErrors({ name: 'wasi-fastly', commit: NEW.slice(0, 7), pkg: { homescoop: { source: `fastly/cli@${OLD}` } } }), []);
  assert.deepEqual(sourcePinErrors({ name: 'wasi-fastly', commit: NEW, pkg: {} }), []);
  assert.match(errs(`fastly/cli@${OLD}`).join('\n'), new RegExp(`homescoop\\.source "fastly/cli@${OLD}" != "fastly/cli@${NEW}".*sync-package-version\\.mjs wasi-fastly --write`));
  for (const stale of [`fastly/cli@${NEW.slice(0, 7)}`, `fastly/cli@${NEW}0`, `fastly/cli@${NEW.toUpperCase()}`, `fastly/cli@${NEW.slice(1)}a`, 'fastly/cli', `fastly/cli@${NEW} `]) {
    assert.equal(errs(stale).length, 1, stale);
  }
  assert.match(errs({ repo: 'fastly/cli', commit: NEW }).join('\n'), /homescoop\.source is \{"repo":"fastly\/cli","commit":"23a945d[0-9a-f]+"\}, not "<owner\/repo>@23a945d/);
});

const fastlyRecipe = (version, commit) => `name: wasi-fastly
builder: host
reproducible: true
version: "${version}"
npm: "@ai-ecoverse/wasi-fastly"
summary: "Fastly CLI ${version} for slicc WASI preview1 (command fastly)"
source:
  url: "https://github.com/fastly/cli/archive/${commit}.tar.gz"
  sha256: "be0f2e80ba0588b35e93f710f746910537590690a4569da3a2fff79ee2d0fffa"
  tag: "v{{version}}"
  commit: "${commit}"
  tree: "8fca3e1633547cd11c01079f9180e7d564e55ad9"
about:
  license: Apache-2.0
`;

const fastlyPkg = (version, upstream, source) => `{
  "name": "@ai-ecoverse/wasi-fastly",
  "version": "${version}",
  "description": "The Fastly CLI ${upstream} (fastly) for slicc: manage Fastly services, domains, TLS, stores and stats through slicc's network.",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ai-ecoverse/homescoop.git",
    "directory": "packages/wasi-fastly/package"
  },
  "files": [
    "README.md",
    "LICENSE",
    "bin"
  ],
  "homescoop": {
    "recipe": "wasi-fastly",
    "upstream": "${upstream}",
    ${source === undefined ? '' : `"source": ${JSON.stringify(source)},\n    `}"patches": [
      "0001-wasip1-build.patch"
    ]
  },
  "slicc": {
    "abi": "wasi",
    "commands": {
      "fastly": {
        "wasm": "bin/fastly.wasm",
        "imports": "host/fastly-host.mjs"
      }
    }
  }
}
`;

function fixture({ recipe: recipeText, pkg }) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-source-'));
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['sync-package-version.mjs', 'read-recipe.mjs', 'upstream-version-text.mjs', 'npm-tag.mjs', 'package-meta-versions.json', 'check-package-meta.mjs', 'shim-notice.mjs']) {
    copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  }
  const pkgDir = join(dir, 'packages', 'wasi-fastly', 'package');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(dir, 'packages', 'wasi-fastly', 'recipe.yaml'), recipeText);
  writeFileSync(join(pkgDir, 'package.json'), pkg);
  const node = (script, ...args) => spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], { encoding: 'utf8', cwd: dir });
  return {
    node,
    pkg: () => readFileSync(join(pkgDir, 'package.json'), 'utf8'),
    recipe: () => readFileSync(join(dir, 'packages', 'wasi-fastly', 'recipe.yaml'), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('#2228 at Renovate\'s refresh (76025d93): check-package-meta fails the stale field, sync --write sets it to the recipe\'s commit and nothing else', () => {
  const fx = fixture({ recipe: fastlyRecipe('17.2.0', NEW), pkg: fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${OLD}`) });
  try {
    const before = fx.node('check-package-meta.mjs', '--drift', 'wasi-fastly');
    assert.equal(before.status, 1, before.stdout);
    assert.match(before.stderr, new RegExp(`homescoop\\.source "fastly/cli@${OLD}" != "fastly/cli@${NEW}"`));
    assert.match(before.stdout, /package-meta: FAIL 1 of 1 packages/);
    const recipeBefore = fx.recipe();
    const s = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '17.2.0-1\n');
    assert.equal(s.stderr, `sync-package-version: wasi-fastly homescoop.source fastly/cli@${OLD} → fastly/cli@${NEW}\n`);
    assert.equal(fx.pkg(), fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${NEW}`));
    assert.equal(fx.recipe(), recipeBefore);
    const after = fx.node('check-package-meta.mjs', '--drift', 'wasi-fastly');
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /package-meta: PASS 1 packages match their recipe/);
    const again = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stderr, '');
    assert.equal(fx.pkg(), fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${NEW}`));
  } finally {
    fx.cleanup();
  }
});

test('#2228 from Renovate\'s bump (a444683b) after the re-pin: one sync --write gives the version, upstream, description and source', () => {
  const fx = fixture({ recipe: fastlyRecipe('17.2.0', NEW), pkg: fastlyPkg('17.1.0-1', '17.1.0', `fastly/cli@${OLD}`) });
  try {
    const s = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '17.2.0-1\n');
    assert.match(s.stderr, new RegExp(`homescoop\\.source fastly/cli@${OLD} → fastly/cli@${NEW}`));
    assert.equal(fx.pkg(), fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${NEW}`));
    const c = fx.node('check-package-meta.mjs', '--drift', 'wasi-fastly');
    assert.equal(c.status, 0, c.stderr);
  } finally {
    fx.cleanup();
  }
});

test('sync --write keeps the field\'s owner/repo, and --check (the publish job\'s) is unchanged by the field', () => {
  const fx = fixture({ recipe: fastlyRecipe('17.2.0', NEW), pkg: fastlyPkg('17.2.0-1', '17.2.0', `Fastly/fastly-cli@${OLD}`) });
  try {
    const c = fx.node('sync-package-version.mjs', 'wasi-fastly', '--check');
    assert.equal(c.status, 0, c.stderr);
    assert.equal(fx.pkg(), fastlyPkg('17.2.0-1', '17.2.0', `Fastly/fastly-cli@${OLD}`));
    const s = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(fx.pkg(), fastlyPkg('17.2.0-1', '17.2.0', `Fastly/fastly-cli@${NEW}`));
  } finally {
    fx.cleanup();
  }
});

test('sync --write adds no field where package.json has none, and leaves the field alone when the recipe has no 40-hex source.commit', () => {
  const cases = [
    [fastlyRecipe('17.2.0', NEW), fastlyPkg('17.2.0-1', '17.2.0', undefined)],
    [fastlyRecipe('17.2.0', NEW).replace(/^  commit: .*\n/m, ''), fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${OLD}`)],
    [fastlyRecipe('17.2.0', NEW).replace(`commit: "${NEW}"`, `commit: "${NEW.slice(0, 7)}"`), fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${OLD}`)],
  ];
  for (const [recipeText, pkg] of cases) {
    const fx = fixture({ recipe: recipeText, pkg });
    try {
      const s = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
      assert.equal(s.status, 0, s.stderr);
      assert.equal(s.stderr, '');
      assert.equal(fx.pkg(), pkg);
      const c = fx.node('check-package-meta.mjs', '--drift', 'wasi-fastly');
      assert.equal(c.status, 0, c.stderr);
    } finally {
      fx.cleanup();
    }
  }
});

test('a "source" elsewhere in package.json with another value is not rewritten', () => {
  const pkg = fastlyPkg('17.2.0-1', '17.2.0', `fastly/cli@${OLD}`).replace('"abi": "wasi",', '"abi": "wasi",\n    "source": "fastly/cli@v17.2.0",');
  const fx = fixture({ recipe: fastlyRecipe('17.2.0', NEW), pkg });
  try {
    const s = fx.node('sync-package-version.mjs', 'wasi-fastly', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(fx.pkg(), pkg.replace(`"source": "fastly/cli@${OLD}"`, `"source": "fastly/cli@${NEW}"`));
    assert.equal(JSON.parse(fx.pkg()).slicc.source, 'fastly/cli@v17.2.0');
  } finally {
    fx.cleanup();
  }
});
