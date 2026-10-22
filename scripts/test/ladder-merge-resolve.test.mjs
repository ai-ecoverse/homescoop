import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LADDER, PUBLISH_PATH, candidateProblems, changedFiles, githubApi, parseArgs, publishPathProblem, resolvePackage, touchingCommit } from '../ladder-merge-resolve.mjs';
import { job } from './ladder-workflow.mjs';

const NAME = '@ai-ecoverse/wasi-impeccable';
const VERSION = '0.1.14-1';
const GOOD = '07f7c1cf8a6bf35a1553485537e4d6befbba751e6a3d1eef0555af65c1450b60';
const OTHER = 'd8a5152bacc27b2d5c3a26296b0239d84f2853469bb2fa0cb2419829b11a215f';
const HEAD = 'dea953c9b0682a7f6bce2a102c07652d4b0d5f9f';
const STALE = '340364dd00000000000000000000000000000000';

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
  return { id, path: LADDER, event: 'pull_request', head_sha: head, status: 'completed', conclusion, ...extra };
}

const PR = { number: 336, head: HEAD, author: 'trieloff' };

function fakeIo({ published = false, pr = PR, files = ['packages/wasi-impeccable/recipe.yaml'], artifacts = [], runs = {}, jobs = {}, tarballs = {} } = {}) {
  const calls = [];
  return {
    calls,
    async published(name, version) {
      calls.push(['published', name, version]);
      return published;
    },
    async pullRequest() {
      calls.push(['pullRequest']);
      return pr;
    },
    async changedFiles(p) {
      calls.push(['changedFiles', p.number, p.head]);
      return files;
    },
    async artifacts(name) {
      calls.push(['artifacts', name]);
      return artifacts;
    },
    async run(id) {
      calls.push(['run', id]);
      if (!runs[id]) throw Object.assign(new Error(`GET /actions/runs/${id} returned 404`), { status: 404 });
      return runs[id];
    },
    async jobs(id) {
      calls.push(['jobs', id]);
      if (typeof jobs[id] === 'number') {
        throw Object.assign(new Error(`GET /actions/runs/${id}/jobs?filter=latest&per_page=100 returned ${jobs[id]}`), { status: jobs[id] });
      }
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

const ctx = { pkg: 'wasi-impeccable', name: NAME, version: VERSION, assumeUnpublished: false };


describe('candidate runs', () => {
  const ok = { artifact: artifact(1, 10, HEAD), run: run(10, HEAD), jobs: [], head: HEAD };

  it('accepts a successful ladder-build pull_request run at the merged head', () => {
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
      /not \.github\/workflows\/ladder-build\.yml/,
    );
    assert.match(candidateProblems({ ...ok, run: run(10, HEAD, 'success', { event: 'workflow_dispatch' }) }).join(), /a workflow_dispatch run, not a pull_request run/);
    assert.match(candidateProblems({ ...ok, run: run(10, HEAD, 'success', { event: 'merge_group' }) }).join(), /a merge_group run/);
  });

  it('a failed review fails the run, and so the candidate: its jobs are named', () => {
    const jobs = [
      { name: 'ci', conclusion: 'failure' },
      { name: 'pipeline / review', conclusion: 'failure' },
      { name: 'pipeline / reviewer (codex)', conclusion: 'success' },
    ];
    assert.match(candidateProblems({ ...ok, run: run(10, HEAD, 'failure'), jobs }).join(), /concluded failure \(ci: failure, pipeline \/ review: failure\)$/);
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
    const result = await resolvePackage(ctx, io);
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
      run: '20',
    });
    assert.equal(result.gate, 'green ladder-build run 20 of PR #336');
    assert.deepEqual(io.calls.filter(([c]) => c === 'download'), [['download', 2]]);
  });

  it('publishes the newest green candidate, with the sha its own tarball has', async () => {
    const io = fakeIo({
      artifacts: [artifact(2, 20, HEAD), artifact(1, 10, HEAD)],
      runs: { 20: run(20, HEAD), 10: run(10, HEAD) },
      tarballs: { 2: tarball(OTHER), 1: tarball(GOOD) },
    });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.inputs.artifact_id, '2');
    assert.equal(result.inputs.certified, OTHER);
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

  it('publishes the newer artifact when an older run at the head returns 502 for its jobs', async () => {
    const io = fakeIo({
      artifacts: [artifact(2, 20, HEAD), artifact(1, 10, HEAD)],
      runs: { 20: run(20, HEAD), 10: run(10, HEAD, 'failure') },
      jobs: { 10: 502 },
      tarballs: { 2: tarball(GOOD) },
    });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.decision, 'publish');
    assert.equal(result.inputs.artifact_id, '2');
    assert.equal(result.inputs.certified, GOOD);
  });

  it('rejects a superseded artifact at another head without fetching its run or jobs', async () => {
    const io = fakeIo({
      artifacts: [artifact(2, 20, HEAD), artifact(1, 10, STALE)],
      runs: { 20: run(20, HEAD), 10: run(10, STALE) },
      jobs: { 10: 502 },
      tarballs: { 2: tarball(GOOD) },
    });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.inputs.artifact_id, '2');
    assert.deepEqual(io.calls.filter(([c]) => c === 'run' || c === 'jobs'), [['run', 20], ['jobs', 20]]);
  });

  it('rejects a run whose own head is not the PR head without fetching its jobs', async () => {
    const io = fakeIo({
      artifacts: [artifact(2, 20, HEAD), artifact(1, 10, HEAD)],
      runs: { 20: run(20, HEAD), 10: run(10, STALE) },
      jobs: { 10: 502 },
      tarballs: { 2: tarball(GOOD) },
    });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.inputs.artifact_id, '2');
    assert.equal(io.calls.filter(([c, id]) => c === 'jobs' && id === 10).length, 0);
  });

  it('fails closed, naming every rejection, when every candidate errors or is superseded', async () => {
    const io = fakeIo({
      artifacts: [artifact(3, 30, HEAD), artifact(2, 20, HEAD), artifact(1, 10, STALE)],
      runs: { 20: run(20, HEAD), 10: run(10, STALE) },
      jobs: { 20: 502 },
      tarballs: { 1: tarball(GOOD), 2: tarball(GOOD), 3: tarball(GOOD) },
    });
    await assert.rejects(
      resolvePackage(ctx, io),
      /no usable host-wasi-impeccable-pr336: artifact 3: GET \/actions\/runs\/30 returned 404 \| artifact 2: GET \/actions\/runs\/20\/jobs\?filter=latest&per_page=100 returned 502 \| artifact 1: run 10 is at 340364dd/,
    );
    assert.equal(io.calls.some(([c]) => c === 'download'), false);
  });
});

describe('a PR that changes the publish path (homescoop#1712)', () => {
  const green = {
    artifacts: [artifact(2, 20, HEAD)],
    runs: { 20: run(20, HEAD) },
    tarballs: { 2: tarball(GOOD) },
  };
  const pkgFiles = ['packages/wasi-impeccable/recipe.yaml', 'packages/wasi-impeccable/package/package.json'];

  it('NEGATIVE: one that also releases a package is refused before any artifact is read', async () => {
    const io = fakeIo({ ...green, files: [...pkgFiles, LADDER, 'scripts/merge-group-check.mjs'] });
    await assert.rejects(resolvePackage(ctx, io), (err) => {
      assert.match(err.message, /^PR #336 changes the publish path \(\.github\/workflows\/ladder-build\.yml, scripts\/merge-group-check\.mjs\) and releases @ai-ecoverse\/wasi-impeccable@0\.1\.14-1\./);
      assert.match(err.message, /homescoop#1712/);
      assert.match(err.message, /merges without publishing anything: land it in a PR that releases no package, and release @ai-ecoverse\/wasi-impeccable from a later PR$/);
      return true;
    });
    assert.deepEqual(io.calls.map(([c]) => c), ['published', 'pullRequest', 'changedFiles']);
    assert.deepEqual(io.calls[2], ['changedFiles', 336, HEAD]);
  });

  it('NEGATIVE: every publish-path file alone is enough to refuse', async () => {
    for (const file of PUBLISH_PATH) {
      await assert.rejects(resolvePackage(ctx, fakeIo({ ...green, files: [...pkgFiles, file] })), new RegExp(`changes the publish path \\(${file.replace(/[.]/g, '\\.')}\\)`), file);
    }
  });

  it('a package-only PR publishes, next to scripts outside the publish path', async () => {
    const io = fakeIo({ ...green, files: [...pkgFiles, 'scripts/host-run.sh', 'scripts/browser-cert/run.mjs', 'docs/ladder-builds.md'] });
    const result = await resolvePackage(ctx, io);
    assert.equal(result.decision, 'publish');
    assert.equal(result.inputs.certified, GOOD);
  });

  it('a publish-path PR whose package version is already on npm releases nothing and skips', async () => {
    const io = fakeIo({ ...green, published: true, files: [...pkgFiles, LADDER] });
    assert.equal((await resolvePackage(ctx, io)).decision, 'skip');
  });

  it('fails closed when the changed files cannot be read', async () => {
    const io = fakeIo(green);
    io.changedFiles = async () => {
      throw new Error('fatal: bad revision');
    };
    await assert.rejects(resolvePackage(ctx, io), /bad revision/);
  });

  it('publishPathProblem names only the publish-path files', () => {
    const who = { number: 7, name: NAME, version: VERSION };
    assert.equal(publishPathProblem(['packages/x/recipe.yaml', 'scripts/ladder-merge-resolve.mjs.bak', 'xscripts/gate.mjs'], who), '');
    assert.match(publishPathProblem(['scripts/gate.mjs', 'scripts/oidc-publish.sh', 'README.md'], who), /^PR #7 changes the publish path \(scripts\/gate\.mjs, scripts\/oidc-publish\.sh\) and/);
  });

  it('the list covers every script the publish and group jobs run, and the scripts those load', () => {
    const root = join(import.meta.dirname, '..', '..');
    const entries = [job('publish'), job('group')].flatMap((t) => [...t.matchAll(/scripts\/([a-z0-9-]+\.(?:mjs|sh))/g)].map((m) => m[1]));
    assert.ok(entries.includes('ladder-merge-resolve.mjs') && entries.includes('oidc-publish.sh') && entries.includes('merge-group-check.mjs'), entries.join());
    const loads = /(?:from '\.\/|join\(\w+, '(?:scripts\/)?|node\('|"\$\(dirname "\$0"\)\/)([a-z0-9-]+\.mjs)/g;
    const seen = new Set();
    const todo = [...entries, 'list-touched-packages.mjs'];
    while (todo.length) {
      const f = todo.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const m of readFileSync(join(root, 'scripts', f), 'utf8').matchAll(loads)) todo.push(m[1]);
    }
    const missing = [...seen].map((f) => `scripts/${f}`).filter((f) => !PUBLISH_PATH.includes(f));
    assert.deepEqual(missing, []);
    for (const f of [LADDER, 'scripts/review-browser.mjs']) assert.ok(PUBLISH_PATH.includes(f), f);
  });

  it('changedFiles is the PR range base...head, with both sides of a rename', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ladder-merge-files-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    const put = (path, text) => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'test');
      git('config', 'user.email', 'test@example.com');
      git('config', 'commit.gpgsign', 'false');
      put(LADDER, 'name: ladder-build\non: push\njobs: {}\n');
      put('README.md', 'a\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      git('checkout', '-q', '-b', 'pr');
      git('mv', LADDER, '.github/workflows/other.yml');
      put('packages/a/recipe.yaml', 'v2\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'pr');
      const head = git('rev-parse', 'HEAD').trim();
      git('checkout', '-q', 'main');
      put('README.md', 'b\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'main moves');
      git('merge', '-q', '--no-ff', '-m', 'Merge pull request #9 from x/pr', 'pr');
      const merge = git('rev-parse', 'HEAD').trim();
      assert.deepEqual(changedFiles(`${merge}^1`, head, git).sort(), ['.github/workflows/ladder-build.yml', '.github/workflows/other.yml', 'packages/a/recipe.yaml']);
      assert.throws(() => changedFiles(`${merge}^1`, 'f'.repeat(40), git));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('githubApi', () => {
  const replies = (t, statuses) => {
    const seen = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      seen.push(init.method);
      return new Response('{}', { status: statuses[seen.length - 1] ?? 200 });
    });
    return seen;
  };
  const api = githubApi({ repo: 'ai-ecoverse/homescoop', token: 't', retryDelayMs: 1 });

  it('retries a GET once after a 5xx', async (t) => {
    const seen = replies(t, [502, 200]);
    const res = await api('/actions/runs/1/jobs');
    assert.equal(res.status, 200);
    assert.equal(seen.length, 2);
  });

  it('throws when the retry also fails, and never retries a 4xx or a POST', async (t) => {
    const twice = replies(t, [502, 503]);
    await assert.rejects(api('/actions/runs/1/jobs'), (err) => err.status === 503);
    assert.equal(twice.length, 2);
    t.mock.restoreAll();
    const notFound = replies(t, [404, 200]);
    await assert.rejects(api('/actions/runs/1'), (err) => err.status === 404);
    assert.equal(notFound.length, 1);
    t.mock.restoreAll();
    const post = replies(t, [502, 200]);
    await assert.rejects(api('/statuses/x', { method: 'POST', body: {} }), (err) => err.status === 502);
    assert.equal(post.length, 1);
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
    });
    assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, '--dry-run', '--ci-certified', 'sqlite3']), /unknown argument --ci-certified/);
    assert.throws(() => parseArgs(['--package', 'wasi-impeccable', '--sha', '233a01bc']), /usage/);
    assert.throws(() => parseArgs(['--package', '../x', '--sha', sha]), /usage/);
    assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, '--base', 'HEAD^']), /usage/);
    assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, '--dry-run', '--pr', '#386']), /--pr needs a PR number/);
    assert.equal(parseArgs(['--package', 'x', '--sha', sha, '--base', HEAD]).base, HEAD);
    assert.equal(parseArgs(['--package', 'x', '--sha', sha, '--out', '/tmp/release']).out, '/tmp/release');
    assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, '--dry-run', '--message', '']), /unknown argument --message/);
  });

  it('accepts the test overrides only with --dry-run', () => {
    const overrides = [['--assume-unpublished'], ['--head', HEAD], ['--pr', '386']];
    for (const extra of overrides) {
      assert.throws(() => parseArgs(['--package', 'x', '--sha', sha, ...extra]), /need --dry-run/, extra.join(' '));
      assert.doesNotThrow(() => parseArgs(['--package', 'x', '--sha', sha, '--dry-run', ...extra]));
    }
  });
});
