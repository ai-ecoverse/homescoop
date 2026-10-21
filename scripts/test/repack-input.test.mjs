// A repack's input must be attested (cert lane rule, 2026-10-16, from #730):
// scripts/cert-review/repack-input.mjs on recorded registry fixtures (no
// network), and verdict.mjs turning an unverifiable input into INCOMPLETE.
//
// Fixtures (scripts/test/fixtures/repack-input/):
//   attested/    pkgconf 3.0.9-1 as recorded from npm: real SLSA provenance from
//                ladder-build on main, its recipe and build.sh at the attested commit.
//   prebuilt/    the same real attestation, with a build.sh that can stage a
//                prebuilt tree (WASIX_PKGCONF_STAGE, the py-pandas shape). PLANTED.
//   helper/      the same real attestation, with the prebuilt path in a package-local
//                helper build.sh runs ($HOMESCOOP_PKG/stage-prebuilt.sh). PLANTED.
//   otherfetch/  the same real attestation, with a build that homescoop_fetches only an
//                upstream prebuilt; source.sha256 is pinned but never used. PLANTED.
//   planted/     a repack of a version published from a laptop: gitHead, no provenance. PLANTED.
//   unattested/  py-pandas as recorded from npm: 2.3.2-11 repacks 2.3.2-10, which has
//                neither provenance nor a gitHead (#730).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITHUB_HOSTED, MAX_DEPTH, buildFiles, checkProvenance, fetchesPinnedSource, fixtureReader, fixtureRegistry, prebuiltInputs, repackInput, resolveRef } from '../cert-review/repack-input.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures/repack-input');
const script = join(here, '../cert-review/repack-input.mjs');
const verdictScript = join(here, '../cert-review/verdict.mjs');

const run = (dir, pkg, extra = {}) =>
  repackInput({ pkg, ref: 'HEAD', readAt: fixtureReader(dir), registry: fixtureRegistry(dir), ...extra });

test('an attested root built from its pinned source passes', async () => {
  const r = await run(join(fixtures, 'attested'), 'pkgconf');
  assert.equal(r.attested, true, r.reason);
  assert.equal(r.root, '3.0.9-1');
  assert.equal(r.chain[0].commit, '56131d90f3bdbd6120f426a9b0089ed753f4ceb8');
  const cli = spawnSync(process.execPath, [script, '--fixtures', join(fixtures, 'attested'), '--package', 'pkgconf'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.equal(JSON.parse(cli.stdout).attested, true);
});

test('NEGATIVE: a planted repack of an unattested artifact is unverifiable', async () => {
  const r = await run(join(fixtures, 'planted'), 'planted');
  assert.equal(r.attested, false);
  assert.equal(r.root, '1.0.0-1');
  assert.match(r.reason, /root 1\.0\.0-1 has no provenance from homescoop's ladder on main/);
  const cli = spawnSync(process.execPath, [script, '--fixtures', join(fixtures, 'planted'), '--package', 'planted'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
});

test('NEGATIVE: an attested root whose build could stage a prebuilt is unverifiable', async () => {
  const r = await run(join(fixtures, 'prebuilt'), 'pkgconf');
  assert.equal(r.chain[0].provenance, true, 'the attestation itself is real and valid');
  assert.equal(r.attested, false);
  assert.match(r.reason, /^root staged a prebuilt artifact: .*WASIX_PKGCONF_STAGE \(packages\/pkgconf\/build\.sh:13\)/);
});

test('NEGATIVE: an attested root whose prebuilt path sits in a package-local helper is unverifiable', async () => {
  const r = await run(join(fixtures, 'helper'), 'pkgconf');
  assert.equal(r.chain[0].provenance, true);
  assert.equal(r.attested, false);
  assert.ok(r.chain[0].buildFiles.includes('packages/pkgconf/stage-prebuilt.sh'), r.chain[0].buildFiles.join(', '));
  assert.match(r.reason, /^root staged a prebuilt artifact: .*WASIX_PKGCONF_STAGE \(packages\/pkgconf\/stage-prebuilt\.sh:4\)/);
});

test('NEGATIVE: an attested root that homescoop_fetches only something else is unverifiable', async () => {
  const r = await run(join(fixtures, 'otherfetch'), 'pkgconf');
  assert.equal(r.chain[0].provenance, true);
  assert.equal(r.attested, false);
  assert.match(r.reason, /root 3\.0\.9-1's build never fetches the pinned source/);
});

test('helpers: every form build.sh runs a repo script by is followed, recursively, with a depth cap', () => {
  const tree = {
    'packages/p/build.sh': [
      'source "$ROOT/scripts/build-common.sh"',
      'bash "$HOMESCOOP_PKG/a.sh"',
      '"$(dirname "$0")/b.sh"',
      './c.sh',
      'bash d.sh',
      'bash "${HOMESCOOP_PKG}/tools/e.sh"',
      'bash "$SRC_DIR/configure.sh"   # in the fetched source: not ours',
    ].join('\n'),
    'scripts/build-common.sh': 'homescoop_fetch() { :; }',
    'packages/p/a.sh': 'bash "$ROOT/scripts/f.sh"',
    'packages/p/b.sh': ':',
    'packages/p/c.sh': ':',
    'packages/p/d.sh': ':',
    'packages/p/tools/e.sh': 'bash "$(dirname "$0")/g.sh"',
    'packages/p/tools/g.sh': ':',
    'scripts/f.sh': ':',
  };
  const readAt = (_, path) => tree[path] ?? null;
  const b = buildFiles(readAt, 'c', 'p');
  assert.deepEqual(b.problems, []);
  assert.deepEqual(new Set(b.files.map((f) => f.path)), new Set(Object.keys(tree)));

  const missing = buildFiles((_, path) => (path === 'packages/p/build.sh' ? 'bash "$HOMESCOOP_PKG/gone.sh"' : null), 'c', 'p');
  assert.deepEqual(missing.problems, ['packages/p/build.sh runs "$HOMESCOOP_PKG/gone.sh, which isn\'t in the tree']);

  const chain = {};
  for (let i = 0; i <= MAX_DEPTH + 1; i++) chain[i ? `packages/p/h${i}.sh` : 'packages/p/build.sh'] = `bash "$HOMESCOOP_PKG/h${i + 1}.sh"`;
  const deep = buildFiles((_, path) => chain[path] ?? null, 'c', 'p');
  assert.match(deep.problems.join(), /past the depth cap/);

  assert.deepEqual(resolveRef('"$SRC/cnf/configure_mods.sh', 'packages/p/build.sh', 'p').explicit, false);
});

test('the pinned source: a homescoop_fetch of $SRC_SHA / $SHA / the literal sha, not reassigned first', () => {
  const sha = 'ab'.repeat(32);
  const f = (text) => fetchesPinnedSource([{ path: 'build.sh', text }], sha);
  assert.equal(f('homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"'), true);
  assert.equal(f('homescoop_fetch "$URL" "${SHA}" "$TB"'), true);
  assert.equal(f(`homescoop_fetch \\\n  "$URL" \\\n  ${sha} "$TB"`), true);
  assert.equal(f('homescoop_fetch "$OTHER_URL" "$OTHER_SHA" "$TB"'), false);
  assert.equal(f(`homescoop_fetch "$URL" ${'cd'.repeat(32)} "$TB"`), false);
  assert.equal(f('SRC_SHA="$(cat other.sha)"\nhomescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"'), false);
  assert.equal(f('# homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"'), false);
});

test('py-pandas as recorded (#730): 2.3.2-10 has no provenance and no gitHead', async () => {
  const r = await run(join(fixtures, 'unattested'), 'py-pandas');
  assert.equal(r.attested, false);
  assert.deepEqual(r.chain.map((l) => l.version), ['2.3.2-10']);
  assert.match(r.reason, /2\.3\.2-10 has no provenance .* and no gitHead/);
});

test('the static prebuilt rule: py-pandas and py-numpy shapes, comments ignored', () => {
  const hits = prebuiltInputs([
    {
      path: 'build.sh',
      text: [
        '# ${WASIX_X_STAGE:-ignored in a comment}',
        'STAGE="${WASIX_PANDAS_STAGE:-$WORK/stage}"',
        'WHL="${WASIX_PANDAS_WHEEL:-}"',
        'REL_URL="${WASIX_NUMPY_RELEASE_URL:-https://github.com/ai-ecoverse/homescoop/releases/download/x/y.tgz}"',
        'SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"',
        'TARBALL="$WORK/x.tar.gz"',
        'homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"',
      ].join('\n'),
    },
  ]);
  assert.deepEqual(
    hits.map((h) => `${h.line} ${h.why}`),
    [
      '2 env-overridable prebuilt input WASIX_PANDAS_STAGE',
      '3 env-overridable prebuilt input WASIX_PANDAS_WHEEL',
      '4 env-overridable prebuilt input WASIX_NUMPY_RELEASE_URL',
      "4 a download of homescoop's own release artifacts",
      '5 a tree outside the repo ($ROOT/..)',
    ],
  );
});

/** A copy of the attested fixture with the SLSA statement edited. */
async function withStatement(edit) {
  const dir = mkdtempSync(join(tmpdir(), 'repack-input-'));
  cpSync(join(fixtures, 'attested'), dir, { recursive: true });
  const file = join(dir, 'attestations', '@ai-ecoverse%2fwasm-pkgconf@3.0.9-1.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const slsa = doc.attestations.find((a) => a.predicateType === 'https://slsa.dev/provenance/v1');
  const statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  edit(statement);
  slsa.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  writeFileSync(file, JSON.stringify(doc));
  try {
    return await run(dir, 'pkgconf');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('NEGATIVE: provenance that is not for these bytes, or not from ladder-build on main, does not count', async () => {
  const cases = [
    [(s) => (s.subject[0].digest.sha512 = '00'.repeat(64)), /other bytes than the published tarball's/],
    [(s) => (s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/bb/evil'), /refs\/heads\/bb\/evil, not refs\/heads\/main/],
    [(s) => (s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml'), /other\.yml, not/],
    [(s) => (s.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/someone/fork'), /someone\/fork/],
  ];
  for (const [edit, why] of cases) {
    const r = await withStatement(edit);
    assert.equal(r.attested, false);
    assert.match(r.reason, why);
  }
});

test('checkProvenance takes another repository, workflow and ref, and can require a GitHub-hosted builder', () => {
  const repo = 'https://github.com/ai-ecoverse/slicc-kernel';
  const integrity = `sha512-${Buffer.from('ab'.repeat(64), 'hex').toString('base64')}`;
  const doc = (edit = () => {}) => {
    const statement = {
      subject: [{ name: 'pkg:npm/%40ai-ecoverse/slicc-kernel@1.0.0', digest: { sha512: 'ab'.repeat(64) } }],
      predicate: {
        buildDefinition: {
          externalParameters: { workflow: { repository: repo, path: '.github/workflows/release.yml', ref: 'refs/heads/main' } },
          resolvedDependencies: [{ uri: `git+${repo}@refs/heads/main`, digest: { gitCommit: 'c'.repeat(40) } }],
        },
        runDetails: { builder: { id: GITHUB_HOSTED }, metadata: { invocationId: 'run' } },
      },
    };
    edit(statement);
    return { attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }] };
  };
  const opts = { npm: '@ai-ecoverse/slicc-kernel', version: '1.0.0', integrity, repo, workflows: ['.github/workflows/release.yml'], hosted: true };
  assert.deepEqual(checkProvenance(doc(), opts), { ok: true, reason: '', commit: 'c'.repeat(40), run: 'run', builder: GITHUB_HOSTED, workflow: '.github/workflows/release.yml' });
  assert.match(checkProvenance(doc(), { ...opts, repo: undefined, workflows: undefined }).reason, /slicc-kernel, not https:\/\/github.com\/ai-ecoverse\/homescoop/);
  const selfHosted = doc((s) => (s.predicate.runDetails.builder.id = 'https://github.com/actions/runner/self-hosted'));
  assert.match(checkProvenance(selfHosted, opts).reason, /self-hosted, not GitHub-hosted/);
  assert.equal(checkProvenance(selfHosted, { ...opts, hosted: false }).ok, true);
  const noCommit = doc((s) => (s.predicate.buildDefinition.resolvedDependencies = []));
  assert.match(checkProvenance(noCommit, opts).reason, /names no slicc-kernel commit/);
});

test('NEGATIVE: an unattested repack in the middle of the chain breaks it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'repack-input-'));
  try {
    cpSync(join(fixtures, 'attested'), dir, { recursive: true });
    const mid = '2222222222222222222222222222222222222222';
    const pkm = join(dir, 'packument', '@ai-ecoverse%2fwasm-pkgconf.json');
    const doc = JSON.parse(readFileSync(pkm, 'utf8'));
    doc.versions['3.0.9-2'] = { version: '3.0.9-2', gitHead: mid, dist: { integrity: 'sha512-AAAA' } };
    writeFileSync(pkm, JSON.stringify(doc));
    mkdirSync(join(dir, 'tree', mid, 'packages/pkgconf'), { recursive: true });
    writeFileSync(join(dir, 'tree', mid, 'packages/pkgconf/recipe.yaml'), 'name: pkgconf\nrepack:\n  from: "3.0.9-1"\n');
    writeFileSync(join(dir, 'tree', 'HEAD', 'packages/pkgconf/recipe.yaml'), 'name: pkgconf\nnpm: "@ai-ecoverse/wasm-pkgconf"\nrepack:\n  from: "3.0.9-2"\n');
    const r = await run(dir, 'pkgconf');
    assert.equal(r.attested, false);
    assert.match(r.reason, /3\.0\.9-2 is a repack of 3\.0\.9-1 published without CI provenance/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unattested root counts once a reproducible rebuild matched its bytes', async () => {
  const dir = join(fixtures, 'planted');
  const integrity = JSON.parse(readFileSync(join(dir, 'packument', '@ai-ecoverse%2fwasm-planted.json'), 'utf8')).versions['1.0.0-1'].dist.integrity;
  const ok = await run(dir, 'planted', { reproduced: { '@ai-ecoverse/wasm-planted@1.0.0-1': integrity } });
  assert.equal(ok.attested, true, ok.reason);
  const other = await run(dir, 'planted', { reproduced: { '@ai-ecoverse/wasm-planted@1.0.0-1': 'sha512-BBBB' } });
  assert.equal(other.attested, false);
  assert.match(other.reason, /a rebuild gave other bytes/);
});

test('verdict.mjs: an unverifiable input is INCOMPLETE whatever the reviewer says', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repack-verdict-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const art = join(dir, 'artifacts', 'host-py-pandas-pr1');
  mkdirSync(join(dir, 'pkg', 'package'), { recursive: true });
  mkdirSync(art, { recursive: true });
  writeFileSync(join(dir, 'pkg', 'package', 'package.json'), '{"name":"@ai-ecoverse/py-pandas","version":"2.3.2-12"}\n');
  execFileSync('tar', ['-czf', join(art, 'package.tgz'), '-C', join(dir, 'pkg'), 'package']);
  const sha = execFileSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(join(art, 'package.tgz'))})).digest('hex'))`], { encoding: 'utf8' });
  writeFileSync(join(art, 'package.tgz.sha256'), `${sha}  package.tgz\n`);
  const review = join(dir, 'review');
  mkdirSync(review);
  const verdict = (v, input) => {
    writeFileSync(join(review, 'verdict.json'), JSON.stringify({ packages: [{ package: 'py-pandas', verdict: v, reason: 'broken' }] }));
    const args = ['--artifacts', join(dir, 'artifacts'), '--pr', '1', '--review', review, '--body', join(dir, 'body.md'), '--lines', join(dir, 'lines.txt'), '--ladder-conclusion', 'success'];
    if (input !== undefined) {
      writeFileSync(join(dir, 'repack-input.json'), JSON.stringify(input));
      args.push('--repack-input', join(dir, 'repack-input.json'));
    }
    const r = spawnSync(process.execPath, [verdictScript, ...args], { encoding: 'utf8' });
    return { status: r.status, lines: readFileSync(join(dir, 'lines.txt'), 'utf8').trim(), body: readFileSync(join(dir, 'body.md'), 'utf8') };
  };
  const unattested = await run(join(fixtures, 'unattested'), 'py-pandas');
  const attested = { ...(await run(join(fixtures, 'attested'), 'pkgconf')), package: 'py-pandas' };

  const incomplete = verdict('certified', { 'py-pandas': unattested });
  assert.equal(incomplete.status, 1);
  assert.equal(incomplete.lines, `cert-ci: INCOMPLETE @ai-ecoverse/py-pandas@2.3.2-12: unverifiable input: ${unattested.reason}`);
  assert.doesNotMatch(incomplete.lines, /certified=/);
  assert.match(incomplete.body, /Not certified, whatever the review says/);

  const pass = verdict('certified', { 'py-pandas': attested });
  assert.equal(pass.status, 0, pass.lines);
  assert.equal(pass.lines, `certified=${sha} @ai-ecoverse/py-pandas 2.3.2-12`);

  // A built recipe passes only with attested: true (#864); the old
  // { repack: false, attested: null } shape now fails closed.
  const notRepack = verdict('certified', { 'py-pandas': { package: 'py-pandas', repack: false, attested: null } });
  assert.equal(notRepack.status, 1);
  assert.match(notRepack.lines, /^cert-ci: INCOMPLETE .*unverifiable input: no reason given$/);
  const built = verdict('certified', { 'py-pandas': { package: 'py-pandas', repack: false, built: true, attested: true, reason: 'ok' } });
  assert.equal(built.status, 0, built.lines);

  const missing = verdict('certified', {});
  assert.equal(missing.status, 1);
  assert.match(missing.lines, /INCOMPLETE .*repack-input\.mjs didn't run for it/);

  const errored = verdict('certified', { 'py-pandas': { package: 'py-pandas', error: 'HTTP 502' } });
  assert.match(errored.lines, /INCOMPLETE .*couldn't trace it \(HTTP 502\)/);

  const failed = verdict('fail', { 'py-pandas': unattested });
  assert.match(failed.lines, /^cert-ci: FAIL .*: broken; also unverifiable input: /);

  const without = verdict('certified', undefined);
  assert.equal(without.status, 0, 'no --repack-input: verdict.mjs as before');
});
