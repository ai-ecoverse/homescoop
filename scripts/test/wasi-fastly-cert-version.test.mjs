import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { agentPattern, recipeCommit, recipeTag, recipeVersion, shortCommit, versionPattern } from '../../packages/wasi-fastly/cert/lib/version.mjs';

const dir = new URL('../../packages/wasi-fastly/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dir), 'utf8');
const pkg = JSON.parse(read('package/package.json'));
const recipe = read('recipe.yaml');
const pinnable = [
  ...readdirSync(new URL('cert/', dir)).filter((f) => f.endsWith('.mjs') || f === 'meta.json').map((f) => `cert/${f}`),
  ...readdirSync(new URL('cert/lib/', dir)).filter((f) => f.endsWith('.mjs')).map((f) => `cert/lib/${f}`),
  ...readdirSync(new URL('test/e2e/', dir)).filter((f) => f.endsWith('.mjs')).map((f) => `test/e2e/${f}`),
];

const says = (version, commit, go = 'go1.27.3') => `Fastly CLI version v${version} (${commit})\nBuilt with go version ${go} wasip1/wasm (2026-11-24)\n`;
const agent = (version) => `FastlyCLI/v${version}, FastlyGo/19.3.1 (+github.com/fastly/go-fastly; go1.27.3)`;
const PUBLISHED_VERSION = 'Fastly CLI version v17.1.0 (3e9473d)\nBuilt with go version go1.27.3 wasip1/wasm (2026-11-25)\n';
const PUBLISHED_AGENT = 'FastlyCLI/v17.1.0, FastlyGo/19.2.0 (+github.com/fastly/go-fastly; go1.27.3)';

test('recipe.yaml and package.json agree on the upstream version and commit', () => {
  const v = recipeVersion();
  const commit = recipeCommit();
  assert.equal(recipeVersion(recipe), v);
  assert.equal(pkg.homescoop.upstream, v);
  assert.match(pkg.version, new RegExp(`^${v.replaceAll('.', '\\.')}-\\d+$`));
  assert.equal(pkg.homescoop.source, `fastly/cli@${commit}`);
  assert.equal(recipeTag(), `v${v}`);
  assert.match(recipe, new RegExp(`^  url: "https://github\\.com/fastly/cli/archive/${commit}\\.tar\\.gz"$`, 'm'));
  assert.equal(shortCommit(), commit.slice(0, 7));
  assert.match(shortCommit(), /^[0-9a-f]{7}$/);
});

test('no cert spec or e2e test pins a fastly version or commit, so a Renovate bump needs no spec edit', () => {
  const v = recipeVersion();
  const short = shortCommit();
  for (const f of pinnable) {
    const text = read(f);
    assert.doesNotMatch(text, /v\d+\\\.\d+\\\.\d+/, `${f} pins a version in a regex`);
    assert.doesNotMatch(text, /Fastly CLI version v\d/, `${f} pins fastly version's text`);
    assert.doesNotMatch(text, /FastlyCLI\\?\/v\d/, `${f} pins a User-Agent version`);
    assert.ok(!text.includes(v), `${f} names ${v}`);
    assert.ok(!text.includes(v.replaceAll('.', '\\.')), `${f} names ${v} as a regex`);
    assert.ok(!text.includes(short), `${f} names the commit ${short}`);
  }
  for (const f of ['cert/checklist.mjs', 'test/e2e/fastly.test.mjs']) {
    const text = read(f);
    assert.ok(text.includes('assert.match(version.stdout, versionPattern())'), `${f} checks fastly version against recipe.yaml`);
    assert.ok(text.includes('assert.match(seen[0].agent, agentPattern())'), `${f} checks the User-Agent against recipe.yaml`);
  }
  assert.ok(read('cert/vcl.mjs').includes('`FastlyCLI/v${recipeVersion()}`'), 'vcl.mjs checks the sandbox User-Agent against recipe.yaml');
});

test("fastly version and the User-Agent that name recipe.yaml's version and commit pass", () => {
  const v = recipeVersion();
  assert.match(says(v, shortCommit()), versionPattern());
  assert.match(says(v, shortCommit(), 'go1.28.0'), versionPattern());
  assert.match(agent(v), agentPattern());
});

test('a future upstream passes with no spec change', () => {
  const next = recipe
    .replace(/^version: ".*"$/m, 'version: "17.3.0"')
    .replace(/^  commit: ".*"$/m, '  commit: "0123456789abcdef0123456789abcdef01234567"');
  const v = recipeVersion(next);
  const commit = recipeCommit(next);
  assert.equal(v, '17.3.0');
  assert.equal(recipeTag(next), 'v17.3.0');
  assert.equal(shortCommit(commit), '0123456');
  assert.match(says('17.3.0', '0123456'), versionPattern(v, shortCommit(commit)));
  assert.match(agent('17.3.0'), agentPattern(v));
  assert.doesNotMatch(says(recipeVersion(), shortCommit()), versionPattern(v, shortCommit(commit)));
});

test('NEGATIVE: the previously published wasi-fastly (17.1.0-1) fails the version and User-Agent rows at recipe.yaml', () => {
  assert.notEqual(recipeVersion(), '17.1.0');
  assert.doesNotMatch(PUBLISHED_VERSION, versionPattern());
  assert.doesNotMatch(PUBLISHED_AGENT, agentPattern());
  assert.match(PUBLISHED_VERSION, versionPattern('17.1.0', '3e9473d'));
  assert.match(PUBLISHED_AGENT, agentPattern('17.1.0'));
});

test('NEGATIVE: a wrong version fails, with no prefix match and literal dots', () => {
  const v = recipeVersion();
  const [major, minor, patch] = v.split('.').map(Number);
  const short = shortCommit();
  for (const wrong of [`${major}.${minor}.${patch + 1}`, `${major}.${minor}.${patch}0`, `${major}.${minor}0.${patch}`, `1${v}`, `${major}.${minor}.${patch}.0`, v.replaceAll('.', 'x'), `${major}.${minor + 1}.${patch}`]) {
    assert.doesNotMatch(says(wrong, short), versionPattern(), `fastly version v${wrong}`);
    assert.doesNotMatch(agent(wrong), agentPattern(), `FastlyCLI/v${wrong}`);
  }
  assert.doesNotMatch(`FastlyCLI/v${v}`, agentPattern(), 'the API User-Agent names FastlyGo');
  assert.doesNotMatch(`X-FastlyCLI/v${v}, FastlyGo/19.3.1`, agentPattern());
  assert.doesNotMatch(`FastlyCLI/${v}, FastlyGo/19.3.1`, agentPattern());
});

test('NEGATIVE: a wrong or malformed commit fails', () => {
  const v = recipeVersion();
  const commit = recipeCommit();
  const short = shortCommit();
  const flip = (c) => (c === '0' ? '1' : '0');
  for (const wrong of [`${short.slice(0, 6)}${flip(short[6])}`, `${flip(short[0])}${short.slice(1)}`, commit.slice(0, 8), commit.slice(0, 6), short.toUpperCase(), '3e9473d', commit]) {
    if (wrong === short) continue;
    assert.doesNotMatch(says(v, wrong), versionPattern(), `fastly version (${wrong})`);
  }
});

test('NEGATIVE: anything more or less than the two version lines fails', () => {
  const v = recipeVersion();
  const good = says(v, shortCommit());
  assert.doesNotMatch(`${good}\nA new version of the Fastly CLI is available.\n`, versionPattern());
  assert.doesNotMatch(good.split('\n')[0] + '\n', versionPattern());
  assert.doesNotMatch(good.replace('wasip1/wasm', 'linux/amd64'), versionPattern());
  assert.doesNotMatch(`INFO: x\n${good}`, versionPattern());
  assert.doesNotMatch(good.trimEnd(), versionPattern());
});

test('NEGATIVE: a recipe with no X.Y.Z version, no source.commit or no source.tag fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: wasi-fastly\n'), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeCommit(recipe.replace(/^  commit: ".*"$/m, '  commit: "23a945d"')), /recipe\.yaml names no 40-hex source\.commit/);
  assert.throws(() => recipeCommit(recipe.replace(/^  commit: ".*"\n/m, '')), /recipe\.yaml names no 40-hex source\.commit/);
  const elsewhere = recipe.replace(/^  commit: ".*"\n/m, '').replace(/^toolchain:\n/m, `toolchain:\n  commit: "${recipeCommit()}"\n`);
  assert.throws(() => recipeCommit(elsewhere), /recipe\.yaml names no 40-hex source\.commit/, 'only source.commit counts');
  assert.throws(() => recipeTag(recipe.replace(/^  tag: ".*"\n/m, '')), /recipe\.yaml names no source\.tag/);
});

test('NEGATIVE: main\'s hard-coded 17.1.0 rows fail the built 17.2.0, which the recipe-driven rows pass', () => {
  const pinned = /^Fastly CLI version v17\.1\.0 \(3e9473d\)\nBuilt with go version go1\.\d+\.\d+ wasip1\/wasm \(\d{4}-\d\d-\d\d\)\n$/;
  const built = 'Fastly CLI version v17.2.0 (23a945d)\nBuilt with go version go1.27.3 wasip1/wasm (2026-11-24)\n';
  assert.doesNotMatch(built, pinned);
  assert.doesNotMatch('FastlyCLI/v17.2.0, FastlyGo/19.3.1 (+github.com/fastly/go-fastly; go1.27.3)', /^FastlyCLI\/v17\.1\.0/);
  assert.match(built, versionPattern('17.2.0', '23a945d'));
});

test('vcl serve is refused on wasip1 (0003), in the cert and in the e2e test', () => {
  const patch = read('patches/0003-wasip1-unavailable-commands.patch');
  assert.ok(patch.includes('+\t"vcl serve": {\n+\t\t"it publishes the VCL to a Fiddle sandbox and then serves it on a local port, which a slicc command cannot open",\n'), '0003 refuses vcl serve in unavailableOnWasip1');
  const added = patch.split(/^diff --git /m).find((part) => part.startsWith('a/pkg/app/slicc.go'));
  const [, count] = /^@@ -0,0 \+1,(\d+) @@$/m.exec(added);
  assert.equal(added.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length, Number(count));
  assert.match(read('cert/unavailable.mjs'), /\[\['vcl', 'serve', 'recv\.vcl'\], \/'fastly vcl serve' is not available in the Fastly CLI for slicc: it publishes the VCL to a Fiddle sandbox/);
  assert.match(read('test/e2e/fastly.test.mjs'), /\[\['vcl', 'serve', 'recv\.vcl'\], \/'fastly vcl serve' is not available in the Fastly CLI for slicc: it publishes the VCL to a Fiddle sandbox/);
});
