// The root rule for every build, not just repacks (cert lane ruling on
// #858/#859, audit #864): scripts/cert-review/repack-input.mjs holds a recipe
// that isn't a repack to the same static rule a repack's root must meet, at
// the reviewed head itself. Its build must fetch the recipe's pinned source
// with the recipe's sha (or build a verified in-tree source), with no stage
// or prebuilt path; otherwise verdict.mjs makes it INCOMPLETE ("unverifiable
// input: <reason>"), whatever the reviewer says.
//
// Every tree here is planted in a temp dir (fixtureReader, no network, no git).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLoopVars, fixtureReader, fixtureRegistry, loopWords, repackInput, unpinnedFetches } from '../cert-review/repack-input.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../cert-review/repack-input.mjs');
const verdictScript = join(here, '../cert-review/verdict.mjs');
const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const COMMON = `homescoop_fetch() {
  local url="$1" sha="$2" tarball="$3"
  curl -fsSL "$url" -o "$tarball"
  echo "$sha  $tarball" | sha256sum -c -
}
`;
const recipe = (source) => `name: demo\nbuilder: host\nversion: "1.0.0"\nnpm: "@ai-ecoverse/wasm-demo"\n${source}`;
const PINNED = `source:\n  url: "https://example.org/demo-{{version}}.tar.gz"\n  sha256: "${SHA}"\n`;
const INTREE = 'source:\n  in-tree: "src Cargo.toml"\n';
const HEAD = `#!/usr/bin/env bash
set -euo pipefail
ROOT="\${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$ROOT/scripts/build-common.sh"
`;
const CLEAN = `${HEAD}homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/demo.tar.gz"\nmake -C "$WORK/demo"\n`;

/** A planted tree at HEAD: { path: text }, plus scripts/build-common.sh. */
function plant(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'built-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries({ 'scripts/build-common.sh': COMMON, ...files })) {
    const file = join(dir, 'tree', 'HEAD', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}
const judge = (dir, pkg = 'demo') => repackInput({ pkg, ref: 'HEAD', readAt: fixtureReader(dir), registry: fixtureRegistry(dir) });
const cli = (dir, pkg = 'demo') => spawnSync(process.execPath, [script, '--fixtures', dir, '--package', pkg], { encoding: 'utf8' });

test('a clean built recipe passes: homescoop_fetch of the pinned source, no prebuilt path', async (t) => {
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': CLEAN });
  const r = await judge(dir);
  assert.equal(r.repack, false);
  assert.equal(r.built, true);
  assert.equal(r.attested, true, r.reason);
  assert.equal(r.sourceSha256, SHA);
  const run = cli(dir);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).attested, true);
});

test('NEGATIVE: a built recipe with a *_STAGE override is unverifiable', async (t) => {
  const build = `${CLEAN}STAGE="\${WASIX_DEMO_STAGE:-$WORK/stage}"\ncp -R "$STAGE" "$HOMESCOOP_PKG/package"\n`;
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': build });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, /^demo at HEAD can stage a prebuilt artifact: .*env-overridable prebuilt input WASIX_DEMO_STAGE \(packages\/demo\/build\.sh:7\)/);
  assert.equal(cli(dir).status, 1);
});

test('NEGATIVE: a built recipe whose homescoop_fetch uses another sha is unverifiable', async (t) => {
  const build = `${HEAD}homescoop_fetch "$SRC_URL" "${OTHER}" "$WORK/demo.tar.gz"\n`;
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': build });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, new RegExp(`demo at HEAD's build never fetches the pinned source \\(no homescoop_fetch of \\$SRC_SHA, \\$SHA or ${SHA}\\)`));
});

test('NEGATIVE: a built recipe (not a repack) that stages a local tree outside the repo is unverifiable (#859)', async (t) => {
  // The emscripten-cache shape: a pinned fetch is there, but the shipped tree
  // can come from ${SOMETHING:-$ROOT/../other-tree}.
  const build = `${CLEAN}SYSROOT="\${EM_SYSROOT_SRC:-$ROOT/../other-tree/cache/sysroot}"\ncp -R "$SYSROOT" "$HOMESCOOP_PKG/package/sysroot"\n`;
  const dir = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': build });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, /^demo at HEAD can stage a prebuilt artifact: .*a tree outside the repo \(\$ROOT\/\.\.\) \(packages\/demo\/build\.sh:7\)/);
});

test('NEGATIVE: a built recipe with sha256: skip, or no build.sh, is unverifiable', async (t) => {
  const skip = plant(t, { 'packages/demo/recipe.yaml': recipe('source:\n  url: "https://example.org/x"\n  sha256: "skip"\n'), 'packages/demo/build.sh': CLEAN });
  assert.match((await judge(skip)).reason, /demo at HEAD's recipe pins no source sha256 \(skip\)/);
  const none = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED) });
  const r = await judge(none);
  assert.equal(r.attested, false);
  assert.match(r.reason, /demo at HEAD's tree has no packages\/demo\/build\.sh/);
});

test('an in-tree source passes once verified: the paths are in the tree, nothing unpinned is downloaded', async (t) => {
  const build = `${HEAD}cargo build --locked --release --manifest-path "$HOMESCOOP_PKG/Cargo.toml"\nif command -v curl >/dev/null; then :; fi\n`;
  const dir = plant(t, {
    'packages/demo/recipe.yaml': recipe(INTREE),
    'packages/demo/build.sh': build,
    'packages/demo/Cargo.toml': '[package]\nname = "demo"\n',
    'packages/demo/src/main.rs': 'fn main() {}\n',
  });
  const r = await judge(dir);
  assert.equal(r.attested, true, r.reason);
  assert.deepEqual(r.inTree, ['src', 'Cargo.toml']);
  assert.equal(cli(dir).status, 0);
});

test('NEGATIVE: an in-tree source plus an unpinned download is unverifiable', async (t) => {
  const files = { 'packages/demo/recipe.yaml': recipe(INTREE), 'packages/demo/Cargo.toml': '', 'packages/demo/src/main.rs': '' };
  const curl = plant(t, { ...files, 'packages/demo/build.sh': `${HEAD}curl -fsSL https://sh.rustup.rs | sh -s -- -y\ncargo build\n` });
  const r = await judge(curl);
  assert.equal(r.attested, false);
  assert.match(r.reason, /demo at HEAD's in-tree build downloads what no pinned sha256 covers: a curl download \(packages\/demo\/build\.sh:5\)/);
  const fetch = plant(t, { ...files, 'packages/demo/build.sh': `${HEAD}homescoop_fetch "$EXTRA_URL" "$EXTRA_SHA" "$WORK/x.tgz"\n` });
  assert.match((await judge(fetch)).reason, /a homescoop_fetch of "\$EXTRA_URL" with no literal sha256 \(packages\/demo\/build\.sh:5\)/);
  // A homescoop_fetch with a literal sha256 is pinned, so it's allowed.
  const pinned = plant(t, { ...files, 'packages/demo/build.sh': `${HEAD}homescoop_fetch "$EXTRA_URL" "${OTHER}" "$WORK/x.tgz"\n` });
  assert.equal((await judge(pinned)).attested, true);
});

test('NEGATIVE: an in-tree declaration that fails verification is unverifiable, never a skip', async (t) => {
  const build = `${HEAD}cargo build --locked\n`;
  const missing = plant(t, { 'packages/demo/recipe.yaml': recipe(INTREE), 'packages/demo/build.sh': build, 'packages/demo/Cargo.toml': '' });
  assert.match((await judge(missing)).reason, /demo at HEAD's in-tree source packages\/demo\/src isn't in its tree HEAD/);
  const outside = plant(t, { 'packages/demo/recipe.yaml': recipe('source:\n  in-tree: "../other/src"\n'), 'packages/demo/build.sh': build });
  assert.match((await judge(outside)).reason, /in-tree source path \.\.\/other\/src isn't a plain path inside packages\/demo/);
  const both = plant(t, { 'packages/demo/recipe.yaml': recipe(`source:\n  in-tree: "src"\n  sha256: "${SHA}"\n`), 'packages/demo/build.sh': build, 'packages/demo/src/a': '' });
  assert.match((await judge(both)).reason, /declares an in-tree source and also source\.url\/sha256/);
  const empty = plant(t, { 'packages/demo/recipe.yaml': recipe('source:\n  in-tree: ""\n'), 'packages/demo/build.sh': build });
  assert.match((await judge(empty)).reason, /declares an in-tree source with no paths/);
  const staged = plant(t, {
    'packages/demo/recipe.yaml': recipe(INTREE),
    'packages/demo/build.sh': `${build}cp -R "\${DEMO_PREBUILT:-$WORK/p}" out\n`,
    'packages/demo/Cargo.toml': '',
    'packages/demo/src/a': '',
  });
  assert.match((await judge(staged)).reason, /can stage a prebuilt artifact: .*DEMO_PREBUILT/);
});

test('helper references: packages/$r/build.sh over a for-loop is followed; an unresolvable package variable fails closed', async (t) => {
  // The imagemagick-relink shape: the fetch happens in the builds it runs.
  const relink = `${HEAD}for r in alpha beta; do\n  bash "$HOMESCOOP_ROOT/packages/$r/build.sh"\ndone\n`;
  const sub = (name) => `${HEAD}homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/${name}.tgz"\nbash "$HOMESCOOP_PKG/relink.sh"\n`;
  const dir = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': relink,
    'packages/alpha/recipe.yaml': recipe(PINNED),
    'packages/beta/recipe.yaml': recipe(PINNED),
    'packages/alpha/build.sh': sub('alpha'),
    'packages/alpha/relink.sh': 'echo alpha\n',
    'packages/beta/build.sh': sub('beta'),
    'packages/beta/relink.sh': 'cp -R "${BETA_ARTIFACT:-x}" y\n',
  });
  const r = await judge(dir);
  // beta's relink.sh, two hops down and resolved against beta's own dir, is read.
  assert.ok(r.buildFiles.includes('packages/alpha/build.sh') && r.buildFiles.includes('packages/beta/relink.sh'), r.buildFiles.join(', '));
  assert.equal(r.attested, false);
  assert.match(r.reason, /BETA_ARTIFACT \(packages\/beta\/relink\.sh:1\)/);
  assert.doesNotMatch(r.reason, /never fetches the pinned source/);

  // Without beta's prebuilt path, the fetches in the followed builds count,
  // since both recipes pin the top recipe's sha.
  const clean = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': relink,
    'packages/alpha/recipe.yaml': recipe(PINNED),
    'packages/beta/recipe.yaml': recipe(PINNED),
    'packages/alpha/build.sh': sub('alpha'),
    'packages/beta/build.sh': sub('beta'),
    'packages/alpha/relink.sh': 'echo alpha\n',
    'packages/beta/relink.sh': 'echo beta\n',
  });
  const c = await judge(clean);
  assert.equal(c.attested, true, c.reason);

  const opaque = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': `${CLEAN}bash "$HOMESCOOP_ROOT/packages/$WHICH/build.sh"\n` });
  const o = await judge(opaque);
  assert.equal(o.attested, false);
  assert.match(o.reason, /runs "\$HOMESCOOP_ROOT\/packages\/\$WHICH\/build\.sh, whose package name is a variable this rule can't resolve/);

  assert.deepEqual(Object.fromEntries(loopWords('for r in a "b"; do x; done\nfor q in $(ls); do y; done')), { r: ['a', 'b'], q: null });
  assert.deepEqual(expandLoopVars('packages/${r}/build.sh', new Map([['r', ['a', 'b']]])), ['packages/a/build.sh', 'packages/b/build.sh']);
  assert.equal(expandLoopVars('packages/$x/build.sh', new Map()), null);
  assert.deepEqual(unpinnedFetches([{ path: 'scripts/install-x.sh', text: 'curl -fsSL "$URL"\n' }]), [], 'shared helpers are not scanned');
});

test('verdict.mjs: a built recipe that fails the rule is INCOMPLETE whatever the reviewer says; a clean one certifies', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'built-verdict-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const art = join(dir, 'artifacts', 'host-demo-pr7');
  mkdirSync(join(dir, 'pkg', 'package'), { recursive: true });
  mkdirSync(art, { recursive: true });
  writeFileSync(join(dir, 'pkg', 'package', 'package.json'), '{"name":"@ai-ecoverse/wasm-demo","version":"1.0.0-1"}\n');
  execFileSync('tar', ['-czf', join(art, 'package.tgz'), '-C', join(dir, 'pkg'), 'package']);
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(readFileSync(join(art, 'package.tgz'))).digest('hex');
  writeFileSync(join(art, 'package.tgz.sha256'), `${sha}  package.tgz\n`);
  const review = join(dir, 'review');
  mkdirSync(review);
  writeFileSync(join(review, 'verdict.json'), JSON.stringify({ packages: [{ package: 'demo', verdict: 'certified' }] }));
  const verdict = (input) => {
    writeFileSync(join(dir, 'input.json'), JSON.stringify({ demo: input }));
    const args = ['--artifacts', join(dir, 'artifacts'), '--pr', '7', '--review', review, '--body', join(dir, 'body.md'), '--lines', join(dir, 'lines.txt'), '--ladder-conclusion', 'success', '--repack-input', join(dir, 'input.json')];
    const r = spawnSync(process.execPath, [verdictScript, ...args], { encoding: 'utf8' });
    return { status: r.status, lines: readFileSync(join(dir, 'lines.txt'), 'utf8').trim(), body: readFileSync(join(dir, 'body.md'), 'utf8') };
  };
  const staged = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': `${CLEAN}X="\${DEMO_STAGE:-y}"\n` });
  const bad = await judge(staged);
  const out = verdict(bad);
  assert.equal(out.status, 1);
  assert.equal(out.lines, `cert-ci: INCOMPLETE @ai-ecoverse/wasm-demo@1.0.0-1: unverifiable input: ${bad.reason}`);
  assert.match(out.body, /Not certified, whatever the review says: an input is unverifiable/);

  const clean = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': CLEAN });
  const ok = verdict(await judge(clean));
  assert.equal(ok.status, 0, ok.lines);
  assert.equal(ok.lines, `certified=${sha} @ai-ecoverse/wasm-demo 1.0.0-1`);

  // Fail closed: a trace that errored is INCOMPLETE, too.
  const broken = plant(t, { 'packages/demo/build.sh': CLEAN });
  const run = cli(broken);
  assert.equal(run.status, 2);
  assert.match(verdict(JSON.parse(run.stdout)).lines, /INCOMPLETE .*couldn't trace it \(no packages\/demo\/recipe\.yaml at HEAD\)/);
});

test('NEGATIVE: a followed package build fetches its own recipe sha, which only counts for that recipe', async (t) => {
  // The top recipe pins A; its build.sh only runs packages/b/build.sh, whose
  // $SHA is b's (homescoop_load_recipe b), pinned to B.
  const top = `${HEAD}bash "$HOMESCOOP_ROOT/packages/b/build.sh"\n`;
  const b = `${HEAD}homescoop_load_recipe b\nhomescoop_fetch "$SRC_URL" "$SHA" "$WORK/b.tgz"\n`;
  const dir = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': top,
    'packages/b/recipe.yaml': recipe(`source:\n  url: "https://example.org/b"\n  sha256: "${OTHER}"\n`),
    'packages/b/build.sh': b,
  });
  const r = await judge(dir);
  assert.equal(r.attested, false);
  assert.match(r.reason, new RegExp(`demo at HEAD's build never fetches the pinned source \\(no homescoop_fetch of \\$SRC_SHA, \\$SHA or ${SHA}\\)`));
  // And a followed package that pins nothing (or skip) is a reason of its own.
  const skip = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': `${CLEAN}bash "$HOMESCOOP_ROOT/packages/b/build.sh"\n`,
    'packages/b/recipe.yaml': recipe('source:\n  url: "https://example.org/b"\n  sha256: "skip"\n'),
    'packages/b/build.sh': b,
  });
  const s = await judge(skip);
  assert.equal(s.attested, false);
  assert.match(s.reason, /demo at HEAD's build runs packages\/b\/, whose recipe pins no source sha256 \(skip\)/);
});

test('NEGATIVE: a package script behind one level of indirection, or a reassigned loop variable, fails closed', async (t) => {
  // PKGDIR="$HOMESCOOP_ROOT/packages/$r" with $r from outside: unresolvable.
  const indirect = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': `${CLEAN}PKGDIR="$HOMESCOOP_ROOT/packages/$1"\nbash "$PKGDIR/build.sh"\n`,
  });
  const i = await judge(indirect);
  assert.equal(i.attested, false);
  assert.match(i.reason, /whose package name is a variable this rule can't resolve/);
  // A variable assigned twice isn't substituted; read as this file, it fails closed.
  const twice = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': `${CLEAN}D="$WORK"\nD="$X"\nbash "$D/build.sh"\n`,
  });
  assert.match((await judge(twice)).reason, /runs "\$D\/build\.sh, a script behind a variable this rule can't resolve \(it would read as packages\/demo\/build\.sh itself\)/);
  // A once-assigned PKG="$HOMESCOOP_PKG" is the package itself: fine.
  const self = plant(t, { 'packages/demo/recipe.yaml': recipe(PINNED), 'packages/demo/build.sh': `${CLEAN}PKG="$HOMESCOOP_PKG"\nKEY="$(cat "$PKG/build.sh" | shasum)"\n` });
  assert.equal((await judge(self)).attested, true);
  // for r in a; do …; done; r="$X"; bash …/packages/$r/build.sh
  const reused = plant(t, {
    'packages/demo/recipe.yaml': recipe(PINNED),
    'packages/demo/build.sh': `${CLEAN}for r in alpha; do echo "$r"; done\nr="$X"\nbash "$HOMESCOOP_ROOT/packages/$r/build.sh"\n`,
    'packages/alpha/recipe.yaml': recipe(PINNED),
    'packages/alpha/build.sh': CLEAN,
  });
  const u = await judge(reused);
  assert.equal(u.attested, false);
  assert.match(u.reason, /packages\/\$r\/build\.sh, whose package name is a variable this rule can't resolve/);
});

test('NEGATIVE: an in-tree build with a package-manager install is unverifiable, unless lockfile-pinned', async (t) => {
  const files = { 'packages/demo/recipe.yaml': recipe(INTREE), 'packages/demo/Cargo.toml': '', 'packages/demo/src/main.rs': '' };
  for (const [line, why] of [
    ['pip install requests', 'a pip install'],
    ['python3 -m pip install x', 'a pip install'],
    ['npx some-tool', 'an npm/pnpm/yarn install'],
    ['npm install', 'an npm/pnpm/yarn install'],
    ['cargo install wasm-tools', 'a cargo download'],
    ['cargo build --release', 'a cargo download'],
    ['go install golang.org/x/tools@latest', 'a go install'],
    ['rustup toolchain install 1.98.1', 'a rustup toolchain download'],
  ]) {
    const dir = plant(t, { ...files, 'packages/demo/build.sh': `${HEAD}${line}\n` });
    const r = await judge(dir);
    assert.equal(r.attested, false, line);
    assert.match(r.reason, new RegExp(`downloads what no pinned sha256 covers: ${why} \\(packages/demo/build\\.sh:5\\)`), line);
  }
  for (const line of ['pip install --require-hashes -r req.txt', 'npm ci', 'pnpm install --frozen-lockfile', 'cargo build --locked --release', 'cargo build --frozen']) {
    const dir = plant(t, { ...files, 'packages/demo/build.sh': `${HEAD}${line}\n` });
    assert.equal((await judge(dir)).attested, true, line);
  }
});
