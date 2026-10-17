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

test('NEGATIVE: every dependency list host-run.sh installs is an input, run: included', async (t) => {
  for (const key of ['run', 'npm', 'mamba']) {
    const text = recipe().replace('  run: []\n', key === 'run' ? '  run:\n    - "@ai-ecoverse/wasm-zlib@1.3.1-2"\n' : `  run: []\n  ${key}: ["@ai-ecoverse/wasm-zlib@1.3.1-2"]\n`);
    const dir = plant(t, { 'packages/demo/recipe.yaml': text });
    const r = await judge(dir);
    assert.equal(r.attested, false, key);
    assert.match(r.reason, /^build input @ai-ecoverse\/wasm-zlib@1\.3\.1-2: /, key);
  }
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
  const conditional = buildFileInputs([{ path: 'packages/demo/build.sh', text: 'if [[ -n "$X" ]]; then\n  export HOMESCOOP_TOOL_VERSION=2025.9.30-32\nfi\neval "$(bash "$ROOT/scripts/install-tool.sh")"\n' }, { path: 'scripts/install-tool.sh', text: helper }]);
  assert.deepEqual(conditional.inputs.map((i) => i.version).sort(), ['2025.9.30-14', '2025.9.30-32'], 'an override a build file sets is an input too, and inside an if the default still is');
  const unresolved = buildFileInputs([{ path: 'scripts/x.sh', text: 'V="$(cat v)"\ncurl -O "https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-$V.tgz"\n' }]);
  assert.match(unresolved.problems.join(), /whose version this rule can't resolve/);
  const npm = buildFileInputs([{ path: 'packages/demo/build.sh', text: [
    'npm pack @ai-ecoverse/wasm-zlib@1.3.1-2',
    'pnpm add -g @ai-ecoverse/wasm-sed',
    'cat > "$PKG/README.md" <<EOF',
    'pnpm add -g @ai-ecoverse/wasm-demo',
    'EOF',
    'get() {',
    '  npm pack @ai-ecoverse/wasm-libpng@1.6.59-1',
    '  env A=1 npx @ai-ecoverse/wasm-xz@5.8.1-1',
    '}',
    'cat > "$WORK/get.sh" <<\'EOF\'',
    'npm pack @ai-ecoverse/wasm-bzip2@1.0.8-3',
    'EOF',
    'cat <<EOF | bash',
    'npm pack @ai-ecoverse/wasm-lcms2@2.19.1-1',
    'EOF',
  ].join('\n') }]);
  assert.deepEqual(npm.inputs.map((i) => `${i.npm}@${i.version}`), ['@ai-ecoverse/wasm-zlib@1.3.1-2', '@ai-ecoverse/wasm-libpng@1.6.59-1', '@ai-ecoverse/wasm-xz@5.8.1-1', '@ai-ecoverse/wasm-bzip2@1.0.8-3', '@ai-ecoverse/wasm-lcms2@2.19.1-1'], 'indented and prefixed commands count, and only a heredoc into a doc file is skipped');
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

test('a helper default that an unconditional top-level export overrides is not an input (homescoop#984)', () => {
  const helper = `#!/usr/bin/env bash\nV="\${HOMESCOOP_WASIX_SYSROOT_VERSION:-2025.9.30-32}"\nfetch "https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-$V.tgz" "$SHA" "$DL/s.tgz"\n`;
  const versions = (build) => buildFileInputs([{ path: 'packages/demo/build.sh', text: build }, { path: 'scripts/install-wasixcc.sh', text: helper }]).inputs.map((i) => i.version).sort();
  const call = 'if ! command -v wasixcc >/dev/null; then\n  eval "$(bash "$ROOT/scripts/install-wasixcc.sh")"\nfi\n';
  const set = 'export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-34\n';
  const both = ['2025.9.30-32', '2025.9.30-34'];
  assert.deepEqual(versions(`#!/usr/bin/env bash\nset -euo pipefail\n${set}${call}`), ['2025.9.30-34'], 'an exported top-level override before the call: only the override');
  assert.deepEqual(versions(`HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-34\nexport HOMESCOOP_WASIX_SYSROOT_VERSION\n${call}`), ['2025.9.30-34'], 'VAR=<literal> then export VAR: only the override');
  assert.deepEqual(versions(`HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-34\n${call}`), both, 'not exported: the helper never sees it');
  assert.deepEqual(versions(`if true; then\n${set}fi\n${call}`), both, 'inside an if (even unindented): both');
  assert.deepEqual(versions(`  ${set}${call}`), both, 'indented: both');
  assert.deepEqual(versions(`f() {\n${set}}\nf\n${call}`), both, 'inside a function: both');
  assert.deepEqual(versions(`(\n${set})\n${call}`), both, 'inside a subshell: both');
  assert.deepEqual(versions(`case "$x" in\n  a)\n${set};;\nesac\n${call}`), both, 'inside a case: both');
  assert.deepEqual(versions(`${call}${set}`), both, 'after the helper call: both');
  assert.deepEqual(versions(`${set}unset HOMESCOOP_WASIX_SYSROOT_VERSION\n${call}`), both, 'unset after the override: both');
  const unresolved = buildFileInputs([{ path: 'packages/demo/build.sh', text: `${set}export HOMESCOOP_WASIX_SYSROOT_VERSION="$(cat v)"\n${call}` }, { path: 'scripts/install-wasixcc.sh', text: helper }]);
  assert.match(unresolved.problems.join(), /whose version this rule can't resolve/, 'reassigned from a command before the call: unresolvable, fails closed');
  assert.deepEqual(versions(`${set}HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-33\n${call}`).includes('2025.9.30-32'), true, 'reassigned to another literal: the default still counts');
  assert.deepEqual(versions(`${set}eval "$(env -i bash "$ROOT/scripts/install-wasixcc.sh")"\n`), both, 'env -i on the helper call: both');
  assert.deepEqual(versions(`${set}eval "$(env -u HOMESCOOP_WASIX_SYSROOT_VERSION bash "$ROOT/scripts/install-wasixcc.sh")"\n`), both, 'env -u VAR on the helper call: both');
  assert.deepEqual(versions(`${set}eval "$(sudo bash "$ROOT/scripts/install-wasixcc.sh")"\n`), both, 'sudo without -E: both');
  assert.deepEqual(versions(`${set}eval "$(sudo -E bash "$ROOT/scripts/install-wasixcc.sh")"\n`), ['2025.9.30-34'], 'sudo -E keeps the environment');
  assert.deepEqual(versions(`DEPS_KEY="$(cat "$ROOT/scripts/install-wasixcc.sh" | shasum)"\n${set}${call}`), both, 'any mention of the helper before the override counts as a call: both');
  assert.deepEqual(versions(`: <<'OFF'\n${set}OFF\n${call}`), both, 'inside a heredoc (the block-comment idiom): both');
  assert.deepEqual(versions(`bash <<EOF\n${set}EOF\n${call}`), both, 'in a heredoc a child shell runs: both');
  assert.deepEqual(versions(`NOTE="first\n${set}last"\n${call}`), both, 'inside a multi-line string: both');
  assert.deepEqual(versions(`reset() { unset HOMESCOOP_WASIX_SYSROOT_VERSION; }\n${set}reset\n${call}`), both, 'a function defined before the override that unsets it: both');
  assert.deepEqual(versions(`reset() { export -n HOMESCOOP_WASIX_SYSROOT_VERSION; }\n${set}reset\n${call}`), both, 'a function that un-exports it: both');
  assert.deepEqual(versions(`for s in install-wasixcc; do eval "$(bash "$ROOT/scripts/$s.sh")"; done\n${set}${call}`), both, 'the helper named through a loop word before the override: both');
  assert.deepEqual(versions(`H=install-wasixcc.sh\neval "$(bash "$ROOT/scripts/$H")"\n${set}${call}`), both, 'the helper named through a variable before the override: both');
  const sourced = buildFileInputs([
    { path: 'packages/demo/build.sh', text: `${set}. "$PKG/env.sh"\n${call}` },
    { path: 'packages/demo/env.sh', text: 'unset HOMESCOOP_WASIX_SYSROOT_VERSION\n' },
    { path: 'scripts/install-wasixcc.sh', text: helper },
  ]).inputs.map((i) => i.version).sort();
  assert.deepEqual(sourced, both, 'a sourced file that unsets it: both');
  const wrapped = buildFileInputs([
    { path: 'packages/demo/build.sh', text: `${set}bash "$ROOT/scripts/wrap.sh"\n` },
    { path: 'scripts/wrap.sh', text: 'eval "$(bash "$ROOT/scripts/install-wasixcc.sh")"\n' },
    { path: 'scripts/install-wasixcc.sh', text: helper },
  ]).inputs.map((i) => i.version).sort();
  assert.deepEqual(wrapped, both, 'the helper run from a shared script, not the package build.sh: both');
});
