// The build-input rule (cert lane ruling, 2026-10-17, on #864): every
// homescoop build input of a build must trace to an attested root at its
// pinned version, or be on scripts/cert-review/known-inputs.txt, whose entries
// expire once the input has an attested successor.
//
// Fixtures (scripts/test/fixtures/build-input/), recorded from npm and git:
//   wasm-zlib 1.3.1-1/-2/-3: no ladder-build provenance (-1's is from release.yml).
//   wasm-libpng 1.6.59-1: no provenance; 1.6.59-2: ladder-build on main at
//     d89ede53, built against wasm-zlib@1.3.1-2 (its recipe and build files).
//   wasix-sysroot 2025.9.30-14: no provenance; its gitHead c20b25fb has no recipe.
// The consumer recipe under review is planted at HEAD in a temp copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_INPUTS, buildFileInputs, fixtureReader, fixtureRegistry, parseKnownInputs, readKnownInputs, recipeInputs, repackInput } from '../cert-review/repack-input.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures/build-input');
const script = join(here, '../cert-review/repack-input.mjs');
const verdictScript = join(here, '../cert-review/verdict.mjs');
const SHA = 'a'.repeat(64);
const COMMON = 'homescoop_fetch() {\n  curl -fsSL "$1" -o "$3"\n  echo "$2  $3" | sha256sum -c -\n}\n';
const HEAD = '#!/usr/bin/env bash\nset -euo pipefail\nROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"\nsource "$ROOT/scripts/build-common.sh"\n';
const CLEAN = `${HEAD}homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/demo.tar.gz"\n`;
const recipe = ({ source = `  url: "https://example.org/demo-{{version}}.tar.gz"\n  sha256: "${SHA}"\n`, build = [] } = {}) =>
  `name: demo\nbuilder: host\nversion: "1.0.0"\nnpm: "@ai-ecoverse/wasm-demo"\nsource:\n${source}dependencies:\n  build:${build.length ? `\n${build.map((b) => `    - "${b}"`).join('\n')}` : ' []'}\n  host: []\n  run: []\n`;
const SYSROOT_14 = 'https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-2025.9.30-14.tgz';

function plant(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'build-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fixtures, dir, { recursive: true });
  for (const [path, text] of Object.entries({ 'scripts/build-common.sh': COMMON, 'packages/demo/build.sh': CLEAN, ...files })) {
    const file = join(dir, 'tree', 'HEAD', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}
const known = (...lines) => parseKnownInputs(lines.join('\n'));
const judge = (dir, list = new Map()) => repackInput({ pkg: 'demo', ref: 'HEAD', readAt: fixtureReader(dir), registry: fixtureRegistry(dir), known: list });

function verdict(t, input, reviewerKnown = []) {
  const dir = mkdtempSync(join(tmpdir(), 'build-input-verdict-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const art = join(dir, 'artifacts', 'host-demo-pr1');
  mkdirSync(join(dir, 'pkg', 'package'), { recursive: true });
  mkdirSync(art, { recursive: true });
  writeFileSync(join(dir, 'pkg', 'package', 'package.json'), '{"name":"@ai-ecoverse/wasm-demo","version":"1.0.0-1"}\n');
  execFileSync('tar', ['-czf', join(art, 'package.tgz'), '-C', join(dir, 'pkg'), 'package']);
  const sha = execFileSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(join(art, 'package.tgz'))})).digest('hex'))`], { encoding: 'utf8' });
  writeFileSync(join(art, 'package.tgz.sha256'), `${sha}  package.tgz\n`);
  const review = join(dir, 'review');
  mkdirSync(review);
  writeFileSync(join(review, 'verdict.json'), JSON.stringify({ packages: [{ package: 'demo', verdict: 'certified', known: reviewerKnown }] }));
  writeFileSync(join(dir, 'repack-input.json'), JSON.stringify({ demo: input }));
  const r = spawnSync(process.execPath, [verdictScript, '--artifacts', join(dir, 'artifacts'), '--pr', '1', '--review', review, '--body', join(dir, 'body.md'), '--lines', join(dir, 'lines.txt'), '--ladder-conclusion', 'success', '--repack-input', join(dir, 'repack-input.json')], { encoding: 'utf8' });
  return { status: r.status, sha, lines: readFileSync(join(dir, 'lines.txt'), 'utf8').trim() };
}

test('an unlisted unattested input is INCOMPLETE', async (t) => {
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe({ build: ['@ai-ecoverse/wasm-zlib@1.3.1-2'] }) });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, /^build input @ai-ecoverse\/wasm-zlib@1\.3\.1-2: 1\.3\.1-2 has no provenance .*\(packages\/demo\/recipe\.yaml:\d+\)$/);
  const v = verdict(t, r);
  assert.equal(v.status, 1);
  assert.match(v.lines, /^cert-ci: INCOMPLETE @ai-ecoverse\/wasm-demo@1\.0\.0-1: unverifiable input: build input @ai-ecoverse\/wasm-zlib@1\.3\.1-2/);
});

test('a listed input stays certified, with the known note forced into the line whatever the reviewer says', async (t) => {
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe({ build: ['@ai-ecoverse/wasm-zlib@1.3.1-2'] }) });
  const r = await judge(dir, known('@ai-ecoverse/wasm-zlib@1.3.1-2 #864 no provenance'));
  assert.equal(r.attested, true, r.reason);
  assert.deepEqual(r.known, ['links unattested @ai-ecoverse/wasm-zlib@1.3.1-2 (homescoop#864)']);
  const v = verdict(t, r);
  assert.equal(v.status, 0, v.lines);
  assert.equal(v.lines, `certified=${v.sha} @ai-ecoverse/wasm-demo 1.0.0-1 (known: links unattested @ai-ecoverse/wasm-zlib@1.3.1-2 (homescoop#864))`);
  const both = verdict(t, r, ['#900']);
  assert.match(both.lines, /\(known: links unattested @ai-ecoverse\/wasm-zlib@1\.3\.1-2 \(homescoop#864\), #900\)$/);
  const bad = verdict(t, { ...r, known: 'links unattested x' });
  assert.equal(bad.status, 1, 'a known that is not a list fails closed');
});

test('NEGATIVE: a listed input with an attested successor has expired: INCOMPLETE until the dependent bumps', async (t) => {
  const list = known('@ai-ecoverse/wasm-libpng@1.6.59-1 #864 laptop publish', '@ai-ecoverse/wasm-zlib@1.3.1-2 #864 no provenance');
  const old = plant(t, { 'packages/demo/recipe.yaml': recipe({ build: ['@ai-ecoverse/wasm-libpng@1.6.59-1'] }) });
  const r = await judge(old, list);
  assert.equal(r.attested, false);
  assert.match(r.reason, /^build input @ai-ecoverse\/wasm-libpng@1\.6\.59-1 is on the known list \(#864\), but @ai-ecoverse\/wasm-libpng@1\.6\.59-2 is attested, so the entry has expired: bump to it/);
  const bumped = plant(t, { 'packages/demo/recipe.yaml': recipe({ build: ['@ai-ecoverse/wasm-libpng@1.6.59-2'] }) });
  const b = await judge(bumped, list);
  assert.equal(b.attested, true, b.reason);
  assert.deepEqual(b.known, ['links unattested @ai-ecoverse/wasm-zlib@1.3.1-2 (homescoop#864)'], 'the attested -2 carries its own listed input up');
  const unlisted = await judge(bumped, known('@ai-ecoverse/wasm-libpng@1.6.59-1 #864 laptop publish'));
  assert.equal(unlisted.attested, false);
  assert.match(unlisted.reason, /^build input @ai-ecoverse\/wasm-libpng@1\.6\.59-2 needs @ai-ecoverse\/wasm-zlib@1\.3\.1-2: /);
  const zlib3 = plant(t, { 'packages/demo/recipe.yaml': recipe({ build: ['@ai-ecoverse/wasm-zlib@1.3.1-2'] }) });
  const z = await judge(zlib3, list);
  assert.equal(z.attested, true, 'a later version without ladder provenance (zlib -3) is no successor');
});

test('NEGATIVE: a source.url on our own npm is an input, not a pinned source (the wasix-sysroot -14 case)', async (t) => {
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe({ source: `  url: "${SYSROOT_14}"\n  sha256: "${SHA}"\n` }) });
  const r = await judge(dir);
  assert.equal(r.attested, false, 'the static rule alone would pass: the build fetches the pinned sha');
  assert.match(r.reason, /^build input @ai-ecoverse\/wasix-sysroot@2025\.9\.30-14: 2025\.9\.30-14's tree c20b25fb83d2 has no packages\/wasix-sysroot\/recipe\.yaml/);
  const listed = await judge(dir, known('@ai-ecoverse/wasix-sysroot@2025.9.30-14 #864 built locally'));
  assert.equal(listed.attested, true, listed.reason);
  assert.deepEqual(listed.known, ['links unattested @ai-ecoverse/wasix-sysroot@2025.9.30-14 (homescoop#864)']);
  const sources = recipeInputs(`source:\n  url: "https://x/y.tgz"\nsources:\n  dev:\n    url: "https://registry.npmjs.org/@ai-ecoverse/wasix-zlib/-/wasix-zlib-{{version}}.tgz"\n`, '1.3.1-2');
  assert.deepEqual(sources.inputs.map((i) => `${i.npm}@${i.version}`), ['@ai-ecoverse/wasix-zlib@1.3.1-2']);
  const odd = recipeInputs('source:\n  url: "https://registry.npmjs.org/@ai-ecoverse/wasix-zlib"\n');
  assert.match(odd.problems.join(), /points at homescoop's npm .* with no tarball this rule can read/);
});

test('NEGATIVE: a tool-only homescoop input (an install-* helper) is checked the same way', async (t) => {
  const helper = `#!/usr/bin/env bash\nTOOL_VERSION="\${HOMESCOOP_TOOL_VERSION:-2025.9.30-14}"\nfetch "https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-$TOOL_VERSION.tgz" "$SHA" "$DL/t.tgz"\n`;
  const build = `${CLEAN}eval "$(bash "$ROOT/scripts/install-tool.sh")"\n`;
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe(), 'packages/demo/build.sh': build, 'scripts/install-tool.sh': helper });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, /^build input @ai-ecoverse\/wasix-sysroot@2025\.9\.30-14: .*\(scripts\/install-tool\.sh:3\)$/);
  const listed = await judge(dir, known('@ai-ecoverse/wasix-sysroot@2025.9.30-14 #864 built locally'));
  assert.equal(listed.attested, true, listed.reason);

  const overridden = buildFileInputs([{ path: 'packages/demo/build.sh', text: 'export HOMESCOOP_TOOL_VERSION=2025.9.30-32\n' }, { path: 'scripts/install-tool.sh', text: helper }]);
  assert.deepEqual(overridden.inputs.map((i) => i.version).sort(), ['2025.9.30-14', '2025.9.30-32'], 'an override a build file sets is an input too');
  const unresolved = buildFileInputs([{ path: 'scripts/x.sh', text: 'V="$(cat v)"\ncurl -O "https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-$V.tgz"\n' }]);
  assert.match(unresolved.problems.join(), /whose version this rule can't resolve/);
  const npm = buildFileInputs([{ path: 'packages/demo/build.sh', text: 'npm pack @ai-ecoverse/wasm-zlib@1.3.1-2\npnpm add -g @ai-ecoverse/wasm-sed\ncat > README.md <<EOF\npnpm add -g @ai-ecoverse/wasm-demo\nEOF\n' }]);
  assert.deepEqual(npm.inputs.map((i) => `${i.npm}@${i.version}`), ['@ai-ecoverse/wasm-zlib@1.3.1-2']);
  assert.deepEqual(npm.problems, ["packages/demo/build.sh:2 installs @ai-ecoverse/wasm-sed, which isn't pinned to an exact version"]);
});

test('the known list: the shipped file parses, every entry names #864, and a malformed line fails closed', async (t) => {
  const list = readKnownInputs();
  assert.ok(list.size > 0);
  for (const [key, entry] of list) assert.equal(entry.issue, '864', key);
  assert.throws(() => parseKnownInputs('@ai-ecoverse/x@1.0.0 no issue'), /isn't "<@scope\/name>@<version> #<issue> <reason>"/);
  assert.throws(() => parseKnownInputs('@ai-ecoverse/x@1.0.0 #1 a\n@ai-ecoverse/x@1.0.0 #1 b'), /repeats/);
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe() });
  writeFileSync(join(dir, 'bad.txt'), '# a comment\n');
  const cli = spawnSync(process.execPath, [script, '--fixtures', dir, '--package', 'demo', '--known', join(dir, 'bad.txt')], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.match(JSON.parse(cli.stdout).error, /known-inputs line 1/);
  const ok = spawnSync(process.execPath, [script, '--fixtures', dir, '--package', 'demo'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(KNOWN_INPUTS, join(here, '../cert-review/known-inputs.txt'));
});
