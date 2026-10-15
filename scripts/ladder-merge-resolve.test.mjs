import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  LADDER_PR,
  candidateProblems,
  certFor,
  parseArgs,
  parseCertLines,
  resolvePackage,
  touchingCommit,
} from './ladder-merge-resolve.mjs';

const NAME = '@ai-ecoverse/wasi-impeccable';
const VERSION = '0.1.14-1';
const GOOD = '07f7c1cf8a6bf35a1553485537e4d6befbba751e6a3d1eef0555af65c1450b60';
const OTHER = 'd8a5152bacc27b2d5c3a26296b0239d84f2853469bb2fa0cb2419829b11a215f';
const HEAD = 'dea953c9b0682a7f6bce2a102c07652d4b0d5f9f';
const STALE = '340364dd00000000000000000000000000000000';
const MERGE_BODY = `Merge pull request #336 from ai-ecoverse/bb/impeccable-0114\n\ncertified=${GOOD} ${NAME} ${VERSION} (known: #343)\n`;

function artifact(id, runId, head, extra = {}) {
  return {
    id,
    name: 'host-wasi-impeccable-pr336',
    expired: false,
    created_at: new Date(Date.UTC(2026, 9, 14, 0, 0, id)).toISOString(),
    workflow_run: { id: runId, head_sha: head },
    ...extra,
  };
}

function run(id, head, conclusion = 'success', extra = {}) {
  return { id, path: LADDER_PR, head_sha: head, status: 'completed', conclusion, ...extra };
}

const PR = { number: 336, head: HEAD, body: 'Bump impeccable', author: 'trieloff' };

function fakeIo({
  published = false,
  pr = PR,
  writers = ['trieloff'],
  artifacts = [],
  runs = {},
  jobs = {},
  tarballs = {},
} = {}) {
  const calls = [];
  return {
    calls,
    async canWrite(login) {
      calls.push(['canWrite', login]);
      return writers.includes(login);
    },
    async published(name, version) {
      calls.push(['published', name, version]);
      return published;
    },
    async pullRequest() {
      calls.push(['pullRequest']);
      return pr;
    },
    async artifacts(name) {
      calls.push(['artifacts', name]);
      return artifacts;
    },
    async run(id) {
      calls.push(['run', id]);
      if (!runs[id]) throw new Error(`GET /actions/runs/${id} returned 404`);
      return runs[id];
    },
    async jobs(id) {
      calls.push(['jobs', id]);
      return jobs[id] ?? [];
    },
    async download(a) {
      calls.push(['download', a.id]);
      return tarballs[a.id] ?? {};
    },
  };
}

function tarball(sha, extra = {}) {
  return { sha, recorded: sha, name: NAME, version: VERSION, ...extra };
}

const ctx = {
  pkg: 'wasi-impeccable',
  name: NAME,
  version: VERSION,
  message: MERGE_BODY,
  ciCertified: false,
  assumeUnpublished: false,
};

describe('the certified= line', () => {
  it('parses the merge body shape, trailing notes included', () => {
    assert.deepEqual(parseCertLines(MERGE_BODY), [{ sha: GOOD, name: NAME, version: VERSION }]);
  });

  it('returns the sha for the named package and version', () => {
    assert.equal(certFor(MERGE_BODY, NAME, VERSION), GOOD);
  });

  it('returns null when only another package is named', () => {
    assert.equal(certFor(`certified=${GOOD} @ai-ecoverse/wasm-sqlite3 3.54.0-1`, NAME, VERSION), null);
    assert.equal(certFor('Merge pull request #1 from x/y', NAME, VERSION), null);
  });

  it('refuses a line for the package at another version', () => {
    assert.throws(
      () => certFor(`certified=${GOOD} ${NAME} 0.1.14-0`, NAME, VERSION),
      /names @ai-ecoverse\/wasi-impeccable 0\.1\.14-0, but the merged package\.json is .* 0\.1\.14-1/,
    );
  });

  it('refuses a malformed sha', () => {
    for (const sha of [GOOD.slice(0, 63), `${GOOD}0`, GOOD.toUpperCase(), `${GOOD.slice(0, 63)}g`, '']) {
      assert.throws(() => certFor(`certified=${sha} ${NAME} ${VERSION}`, NAME, VERSION), /malformed sha256/, sha);
    }
  });

  it('picks the right line among several', () => {
    const body = [
      'Merge pull request #400 from ai-ecoverse/bb/two',
      '',
      `certified=${OTHER} @ai-ecoverse/wasm-sqlite3 3.54.0-2`,
      `  certified=${GOOD} ${NAME} ${VERSION} (known: #343)`,
      `certified=${GOOD} ${NAME} ${VERSION}`,
    ].join('\n');
    assert.equal(parseCertLines(body).length, 3);
    assert.equal(certFor(body, NAME, VERSION), GOOD);
    assert.equal(certFor(body, '@ai-ecoverse/wasm-sqlite3', '3.54.0-2'), OTHER);
  });

  it('refuses conflicting lines for one package and version', () => {
    const body = `certified=${GOOD} ${NAME} ${VERSION}\ncertified=${OTHER} ${NAME} ${VERSION}`;
    assert.throws(() => certFor(body, NAME, VERSION), /conflicting certified= lines/);
  });
});

describe('candidate runs', () => {
  const ok = { artifact: artifact(1, 10, HEAD), run: run(10, HEAD), jobs: [], head: HEAD, needCi: false };

  it('accepts a successful ladder-pr run at the merged head', () => {
    assert.deepEqual(candidateProblems(ok), []);
  });

  it('refuses a stale head', () => {
    const problems = candidateProblems({ ...ok, artifact: artifact(1, 10, STALE), run: run(10, STALE) });
    assert.match(problems.join(), /is at 340364dd.*not the merged head dea953c9/);
  });

  it('refuses a failed, cancelled or unfinished run and names the failed jobs', () => {
    const jobs = [
      { name: 'host-build (wasi-impeccable)', conclusion: 'success' },
      { name: 'cert (wasi-impeccable)', conclusion: 'failure' },
      { name: 'slicc-note', conclusion: 'skipped' },
    ];
    assert.match(
      candidateProblems({ ...ok, run: run(10, HEAD, 'failure'), jobs }).join(),
      /run 10 concluded failure \(cert \(wasi-impeccable\): failure\)$/,
    );
    assert.match(candidateProblems({ ...ok, run: run(10, HEAD, 'cancelled') }).join(), /concluded cancelled/);
    assert.match(
      candidateProblems({ ...ok, run: run(10, HEAD, null, { status: 'in_progress' }) }).join(),
      /concluded in_progress/,
    );
  });

  it('refuses an expired artifact and a run of another workflow', () => {
    assert.match(candidateProblems({ ...ok, artifact: artifact(1, 10, HEAD, { expired: true }) }).join(), /expired/);
    assert.match(
      candidateProblems({ ...ok, run: run(10, HEAD, 'success', { path: '.github/workflows/other.yml' }) }).join(),
      /not \.github\/workflows\/ladder-pr\.yml/,
    );
  });

  it('needs a successful ci job only on the ci-certified path', () => {
    assert.match(candidateProblems({ ...ok, needCi: true }).join(), /no successful ci job \(ci: missing\)/);
    assert.match(
      candidateProblems({ ...ok, needCi: true, jobs: [{ name: 'ci', conclusion: 'failure' }] }).join(),
      /ci: failure/,
    );
    assert.deepEqual(candidateProblems({ ...ok, needCi: true, jobs: [{ name: 'ci', conclusion: 'success' }] }), []);
  });
});

describe('resolvePackage', () => {
  const staleFailed = {
    artifacts: [artifact(3, 30, HEAD), artifact(2, 20, HEAD), artifact(1, 10, STALE)],
    runs: { 30: run(30, HEAD, 'failure'), 20: run(20, HEAD), 10: run(10, STALE) },
    tarballs: { 1: tarball(GOOD), 2: tarball(GOOD), 3: tarball(GOOD) },
  };

  it('skips a version already on npm without looking at PRs or artifacts', async () => {
    const io = fakeIo({ published: true });
    const result = await resolvePackage({ ...ctx, message: '' }, io);
    assert.equal(result.decision, 'skip');
    assert.deepEqual(result.inputs, { package: 'wasi-impeccable' });
    assert.deepEqual(io.calls, [['published', NAME, VERSION]]);
  });

  it('assumeUnpublished ignores the registry', async () => {
    const io = fakeIo({ published: true, ...staleFailed });
    const result = await resolvePackage({ ...ctx, assumeUnpublished: true }, io);
    assert.equal(result.decision, 'publish');
    assert.equal(io.calls.some(([c]) => c === 'published'), false);
  });

  it('picks the artifact at the merged head from the green run and passes its id', async () => {
    const io = fakeIo(staleFailed);
    const result = await resolvePackage(ctx, io);
    assert.equal(result.decision, 'publish');
    assert.deepEqual(result.inputs, {
      package: 'wasi-impeccable',
      certified: GOOD,
      artifact_pr: '336',
      artifact_id: '2',
    });
    assert.deepEqual(io.calls.filter(([c]) => c === 'download'), [['download', 2]]);
  });

  it('takes the green candidate whose tarball matches the line', async () => {
    const io = fakeIo({
      artifacts: [artifact(2, 20, HEAD), artifact(1, 10, HEAD)],
      runs: { 20: run(20, HEAD), 10: run(10, HEAD) },
      tarballs: { 2: tarball(OTHER), 1: tarball(GOOD) },
    });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.inputs.artifact_id, '1');
  });

  it('refuses a tarball that does not match the certified= line', async () => {
    const io = fakeIo({ ...staleFailed, tarballs: { 2: tarball(OTHER) } });
    await assert.rejects(
      resolvePackage(ctx, io),
      new RegExp(`artifact 2: package.tgz sha256 ${OTHER} does not match the certified= line ${GOOD}`),
    );
  });

  it('refuses a tarball whose sha file or package.json disagrees', async () => {
    const recorded = fakeIo({ ...staleFailed, tarballs: { 2: tarball(GOOD, { recorded: OTHER }) } });
    await assert.rejects(resolvePackage(ctx, recorded), /package\.tgz\.sha256 says d8a5/);
    const missing = fakeIo({ ...staleFailed, tarballs: { 2: tarball(GOOD, { recorded: undefined }) } });
    await assert.rejects(resolvePackage(ctx, missing), /package\.tgz\.sha256 says nothing/);
    const version = fakeIo({ ...staleFailed, tarballs: { 2: tarball(GOOD, { version: '0.1.14-0' }) } });
    await assert.rejects(resolvePackage(ctx, version), /is @ai-ecoverse\/wasi-impeccable@0\.1\.14-0, not .*@0\.1\.14-1/);
    const empty = fakeIo({ ...staleFailed, tarballs: {} });
    await assert.rejects(resolvePackage(ctx, empty), /has no package\.tgz/);
  });

  it('refuses when only stale or failed runs exist, naming each', async () => {
    const io = fakeIo({ ...staleFailed, artifacts: [artifact(3, 30, HEAD), artifact(1, 10, STALE)] });
    await assert.rejects(
      resolvePackage(ctx, io),
      /no usable host-wasi-impeccable-pr336: artifact 3: run 30 concluded failure \| artifact 1: run 10 is at 340364dd/,
    );
    assert.equal(io.calls.some(([c]) => c === 'download'), false);
  });

  it('refuses without a line unless the package is ci-certified', async () => {
    const io = fakeIo(staleFailed);
    await assert.rejects(
      resolvePackage({ ...ctx, message: 'Merge pull request #336' }, io),
      /not on npm, neither the merge commit nor the PR body has a certified=<sha256> @ai-ecoverse\/wasi-impeccable 0\.1\.14-1 line, and wasi-impeccable is not in scripts\/ci-certified\.json/,
    );
    assert.deepEqual(io.calls.map(([c]) => c), ['published', 'pullRequest']);
  });

  it('falls back to the PR body when the merge commit has no line', async () => {
    const pr = { ...PR, body: `Queue me\n\ncertified=${GOOD} ${NAME} ${VERSION}\n` };
    const io = fakeIo({ ...staleFailed, pr });
    const result = await resolvePackage({ ...ctx, message: 'Merge pull request #336' }, io);
    assert.equal(result.gate, 'certified= line in the PR #336 body');
    assert.equal(result.inputs.certified, GOOD);
    assert.deepEqual(io.calls.find(([c]) => c === 'canWrite'), ['canWrite', 'trieloff']);
  });

  it('takes the merge commit line over the PR body', async () => {
    const pr = { ...PR, body: `certified=${OTHER} ${NAME} ${VERSION}` };
    const io = fakeIo({ ...staleFailed, pr });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.gate, 'certified= line in the merge commit');
    assert.equal(result.inputs.certified, GOOD);
    assert.equal(io.calls.some(([c]) => c === 'canWrite'), false);
  });

  it('refuses a PR body line from an author who cannot write', async () => {
    const pr = { ...PR, author: 'someone', body: `certified=${GOOD} ${NAME} ${VERSION}` };
    await assert.rejects(
      resolvePackage({ ...ctx, message: 'Merge pull request #336' }, fakeIo({ ...staleFailed, pr })),
      /in the body of PR #336, whose author someone cannot write to this repository/,
    );
  });

  it('parses the PR body like the merge commit', async () => {
    const pr = { ...PR, body: `certified=${GOOD.slice(1)} ${NAME} ${VERSION}` };
    await assert.rejects(
      resolvePackage({ ...ctx, message: 'Merge pull request #336' }, fakeIo({ ...staleFailed, pr })),
      /malformed sha256/,
    );
  });

  it('refuses a wrong-package or wrong-version line', async () => {
    await assert.rejects(
      resolvePackage({ ...ctx, message: `certified=${GOOD} @ai-ecoverse/wasm-sqlite3 3.54.0-1` }, fakeIo(staleFailed)),
      /has a certified=<sha256> @ai-ecoverse\/wasi-impeccable 0\.1\.14-1 line, and wasi-impeccable is not in/,
    );
    await assert.rejects(
      resolvePackage({ ...ctx, ciCertified: true, message: `certified=${GOOD} ${NAME} 0.1.14-0` }, fakeIo(staleFailed)),
      /names @ai-ecoverse\/wasi-impeccable 0\.1\.14-0/,
    );
  });

  it('ci-certified: publishes the green run artifact only when its ci job passed', async () => {
    const message = 'Merge pull request #336';
    const green = fakeIo({ ...staleFailed, jobs: { 20: [{ name: 'ci', conclusion: 'success' }] } });
    const result = await resolvePackage({ ...ctx, message, ciCertified: true }, green);
    assert.equal(result.gate, 'ci-certified (ladder-pr ci job)');
    assert.deepEqual(result.inputs, { package: 'wasi-impeccable', certified: GOOD, artifact_pr: '336', artifact_id: '2' });

    const certFailed = fakeIo({
      ...staleFailed,
      runs: { ...staleFailed.runs, 20: run(20, HEAD, 'failure') },
      jobs: {
        20: [
          { name: 'host-build (wasi-impeccable)', conclusion: 'success' },
          { name: 'cert (wasi-impeccable)', conclusion: 'failure' },
          { name: 'ci', conclusion: 'failure' },
        ],
      },
    });
    await assert.rejects(
      resolvePackage({ ...ctx, message, ciCertified: true }, certFailed),
      /artifact 2: run 20 concluded failure \(cert \(wasi-impeccable\): failure, ci: failure\); run 20 has no successful ci job \(ci: failure\)/,
    );
    assert.equal(certFailed.calls.some(([c]) => c === 'download'), false);

    const noCi = fakeIo(staleFailed);
    await assert.rejects(resolvePackage({ ...ctx, message, ciCertified: true }, noCi), /ci: missing/);
  });

  it('refuses without a merged PR or an artifact', async () => {
    await assert.rejects(resolvePackage(ctx, fakeIo({ pr: null })), /no merged PR/);
    await assert.rejects(resolvePackage(ctx, fakeIo({ artifacts: [] })), /no artifact host-wasi-impeccable-pr336/);
    const renamed = fakeIo({ artifacts: [artifact(1, 10, HEAD, { name: 'host-wasi-impeccable-pr3360' })] });
    await assert.rejects(resolvePackage(ctx, renamed), /no artifact host-wasi-impeccable-pr336/);
  });

  it('fails closed when a run cannot be read', async () => {
    const io = fakeIo({ artifacts: [artifact(1, 10, HEAD)], runs: {} });
    await assert.rejects(resolvePackage(ctx, io), /returned 404/);
  });
});

describe('the pushed range', () => {
  it('maps each package to the newest first-parent commit that touched it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ladder-merge-range-'));
    const cwd = process.cwd();
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    const touch = (path, text) => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    const merge = (branch, path, text) => {
      git('checkout', '-q', '-b', branch, 'main');
      touch(path, text);
      git('add', '-A');
      git('commit', '-q', '-m', `${branch} change`);
      git('checkout', '-q', 'main');
      git('merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch);
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'test');
      git('config', 'user.email', 'test@example.com');
      touch('packages/a/recipe.yaml', 'v1');
      touch('packages/b/package/package.json', '{}');
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      const a1 = merge('a1', 'packages/a/recipe.yaml', 'v2');
      const b1 = merge('b1', 'packages/b/package/package.json', '{"v":2}');
      const doc = merge('doc', 'packages/a/build.sh', 'echo');
      const a2 = merge('a2', 'packages/a/package/README.md', 'hi');
      process.chdir(dir);
      assert.equal(touchingCommit('a', base, a2), a2);
      assert.equal(touchingCommit('a', base, doc), a1);
      assert.equal(touchingCommit('b', base, a2), b1);
      assert.equal(touchingCommit('c', base, a2), a2);
      assert.equal(touchingCommit('b', `${a2}^`, a2), a2);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('arguments', () => {
  const sha = '233a01bc7ef1691fedbb4f6839c8a346609c15c7';

  it('takes a package and a full merge sha', () => {
    assert.deepEqual(parseArgs(['--package', 'wasi-impeccable', '--sha', sha]), {
      pkg: 'wasi-impeccable',
      sha,
      ciCertified: [],
    });
    assert.throws(() => parseArgs(['--package', 'wasi-impeccable', '--sha', '233a01bc']), /usage/);
    assert.throws(() => parseArgs(['--package', '../x', '--sha', sha]), /usage/);
    assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, '--base', 'HEAD^']), /usage/);
    assert.equal(parseArgs(['--package', 'x', '--sha', sha, '--base', HEAD]).base, HEAD);
  });

  it('accepts the test overrides only with --dry-run', () => {
    const overrides = [
      ['--assume-unpublished'],
      ['--message', ''],
      ['--pr-body', ''],
      ['--head', HEAD],
      ['--ci-certified', 'sqlite3'],
    ];
    for (const extra of overrides) {
      assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, ...extra]), /need --dry-run/, extra.join(' '));
      assert.doesNotThrow(() => parseArgs(['--package', 'x', '--sha', sha, '--dry-run', ...extra]));
    }
    assert.deepEqual(
      parseArgs(['--package', 'x', '--sha', sha, '--dry-run', '--ci-certified', 'sqlite3, wasi-impeccable']).ciCertified,
      ['sqlite3', 'wasi-impeccable'],
    );
  });
});
