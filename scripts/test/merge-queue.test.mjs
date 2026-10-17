// Merge queue (homescoop main): ladder-pr's merge_group path binds each queued
// PR's artifact and cert to the group head without building, and ladder-merge
// still finds each PR's certified artifact when several PRs land in one push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LADDER_PR, githubIo, resolvePackage, touchingCommit } from '../ladder-merge-resolve.mjs';
import { checkGroup, gitIn, groupMembers, proofPaths, treeDigester } from '../merge-group-check.mjs';
import { globRegExp } from '../list-touched-packages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'merge-queue-'));
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('config', 'commit.gpgsign', 'false');
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD').trim();
  };
  const pkg = (name, version) => {
    put(`packages/${name}/recipe.yaml`, `name: ${name}\nversion: ${version}\nbuilder: host\n`);
    put(`packages/${name}/package/package.json`, JSON.stringify({ name: `@ai-ecoverse/${name}`, version }));
  };
  pkg('alpha', '1.0.0-1');
  pkg('beta', '2.0.0-1');
  put('scripts/shared.sh', 'echo 1\n');
  const base = commit('base');
  return { dir, git, put, commit, pkg, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function branch(r, name, from, edit) {
  r.git('checkout', '-q', '-b', name, from);
  edit();
  const head = r.commit(name);
  r.git('checkout', '-q', 'main');
  return head;
}

function queueMerge(r, onto, head, number, name) {
  r.git('checkout', '-q', '--detach', onto);
  r.git('merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from ai-ecoverse/${name}\n\n${name}`, head);
  const sha = r.git('rev-parse', 'HEAD').trim();
  r.git('checkout', '-q', 'main');
  return sha;
}

function twoPrGroup(r, { samepackage = false } = {}) {
  const a = branch(r, 'bb/a', r.base, () => r.pkg('alpha', '1.0.0-2'));
  const b = branch(r, 'bb/b', r.base, () => (samepackage ? r.put('packages/alpha/build.sh', 'make\n') : r.pkg('beta', '2.0.0-2')));
  const m1 = queueMerge(r, r.base, a, 11, 'bb/a');
  const m2 = queueMerge(r, m1, b, 12, 'bb/b');
  return { a, b, m1, m2 };
}

function readCtx(r, pkg, commit) {
  const { name, version } = JSON.parse(r.git('show', `${commit}:packages/${pkg}/package/package.json`));
  return { pkg, name, version, message: r.git('log', '-1', '--format=%B', commit), ciCertified: false, assumeUnpublished: false };
}

function touchedOf(r) {
  return (m) => {
    const files = r.git('diff', '--name-only', m.base, m.commit).split('\n').filter(Boolean);
    const all = [...new Set(files.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean))].sort();
    const publishable = [...new Set(files.map((f) => f.match(/^packages\/([^/]+)\/(?:recipe\.yaml$|package\/)/)?.[1]).filter(Boolean))].sort();
    return { all, host: all, publishable };
  };
}

// One PR's ladder-pr run and artifact, as ladder-merge-resolve reads them.
function memberIo({ number, head, sha, pkg, version, author = 'trieloff', reviewState = 'success' }) {
  const runId = 1000 + number;
  const artifact = { id: 2000 + number, name: `host-${pkg}-pr${number}`, expired: false, created_at: '2026-10-17T00:00:00Z', workflow_run: { id: runId, head_sha: head } };
  return {
    published: async () => false,
    pullRequest: async () => ({ number, head, body: `certified=${sha} @ai-ecoverse/${pkg} ${version}`, author }),
    canWrite: async (login) => login === 'trieloff',
    statuses: async () => [
      {
        context: 'cert-review',
        state: reviewState,
        creator: { login: 'github-actions[bot]' },
        target_url: `https://github.com/x/y/actions/runs/${runId + 1}/artifacts/${artifact.id + 1}`,
        description: `certified, run ${runId + 1}, record artifact ${artifact.id + 1}`,
      },
    ],
    run: async (id) =>
      id === runId
        ? { id, path: LADDER_PR, head_sha: head, status: 'completed', conclusion: 'success' }
        : { id, path: '.github/workflows/cert-review.yml', event: 'workflow_run', head_branch: 'main', status: 'completed', conclusion: 'success' },
    artifact: async (id) => ({ id, name: `cert-review-record-${number}`, expired: false, workflow_run: { id: runId + 1 } }),
    record: async () => ({ pr: number, head, cert_review_run: runId + 1, lines: [`certified=${sha} @ai-ecoverse/${pkg} ${version}`] }),
    artifacts: async () => [artifact],
    jobs: async () => [{ name: 'ci', conclusion: 'success' }],
    download: async () => ({ sha, recorded: sha, name: `@ai-ecoverse/${pkg}`, version }),
  };
}

function groupIo(r, g, over = {}) {
  const prs = { 11: { state: 'open', head: { sha: g.a } }, 12: { state: 'open', head: { sha: g.b } }, ...over.prs };
  const ios = {
    11: memberIo({ number: 11, head: g.a, sha: SHA_A, pkg: 'alpha', version: '1.0.0-2', ...over[11] }),
    12: memberIo({ number: 12, head: g.b, sha: SHA_B, pkg: 'beta', version: '2.0.0-2', ...over[12] }),
  };
  return { pull: async (n) => prs[n], member: (m) => ios[m.number] };
}

async function check(r, g, over) {
  const cwd = process.cwd();
  process.chdir(r.dir);
  try {
    return await checkGroup(
      {
        head: g.m2,
        members: groupMembers(r.base, g.m2, r.git),
        touched: touchedOf(r),
        digest: treeDigester(r.git),
        owners: (pkg) => touchingCommit(pkg, r.base, g.m2),
        context: (pkg, m) => readCtx(r, pkg, m.commit),
      },
      groupIo(r, g, over),
    );
  } finally {
    process.chdir(cwd);
  }
}

test('a two-PR group: each queue-made merge commit names its PR, with the PR head as second parent', () => {
  const r = repo();
  try {
    const g = twoPrGroup(r);
    const members = groupMembers(r.base, g.m2, r.git);
    assert.deepEqual(
      members.map((m) => [m.number, m.commit, m.base, m.head]),
      [
        [11, g.m1, r.base, g.a],
        [12, g.m2, g.m1, g.b],
      ],
    );
  } finally {
    r.cleanup();
  }
});

test('ladder-merge on a two-PR group push: each package resolves at its own PR\'s merge, and publishes that PR\'s certified artifact', async () => {
  const r = repo();
  const cwd = process.cwd();
  try {
    const g = twoPrGroup(r);
    process.chdir(r.dir);
    assert.equal(touchingCommit('alpha', r.base, g.m2), g.m1, 'alpha lands with #11, whose merge is not the pushed head');
    assert.equal(touchingCommit('beta', r.base, g.m2), g.m2);
    const alpha = await resolvePackage(readCtx(r, 'alpha', g.m1), memberIo({ number: 11, head: g.a, sha: SHA_A, pkg: 'alpha', version: '1.0.0-2' }));
    const beta = await resolvePackage(readCtx(r, 'beta', g.m2), memberIo({ number: 12, head: g.b, sha: SHA_B, pkg: 'beta', version: '2.0.0-2' }));
    assert.deepEqual(alpha.inputs, { package: 'alpha', certified: SHA_A, artifact_pr: '11', artifact_id: '2011' });
    assert.deepEqual(beta.inputs, { package: 'beta', certified: SHA_B, artifact_pr: '12', artifact_id: '2012' });
  } finally {
    process.chdir(cwd);
    r.cleanup();
  }
});

test('githubIo finds the PR of a queue-made merge commit whose first parent is another PR\'s merge', async () => {
  // Recorded from slicc-kernel's queue (#897 and #900 landed in one group):
  // GET /commits/<merge>/pulls returns the PR, with merge_commit_sha the queue's commit.
  const m897 = '4eb786f430bbf9b8f0e4e548fe03157d52d5ddae';
  const m900 = '85df328f278dec392debba680e47119ecc098021';
  const pulls = {
    [m897]: [{ number: 897, merged_at: '2026-10-17T00:00:00Z', merge_commit_sha: m897, head: { sha: '9b28d4863977ce9a0902c700d3996421cae0384e' }, body: '', user: { login: 'trieloff' } }],
    [m900]: [{ number: 900, merged_at: '2026-10-17T00:00:00Z', merge_commit_sha: m900, head: { sha: 'f85eba383b4e9073829dee4ef27f047942b708ea' }, body: '', user: { login: 'trieloff' } }],
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const sha = String(url).match(/\/commits\/([0-9a-f]{40})\/pulls$/)?.[1];
    return new Response(JSON.stringify(pulls[sha] ?? []), { status: 200 });
  };
  try {
    for (const [sha, [pr]] of Object.entries(pulls)) {
      const got = await githubIo({ repo: 'x/y', token: 't', sha }).pullRequest();
      assert.deepEqual(got, { number: pr.number, head: pr.head.sha, body: '', author: 'trieloff' });
    }
  } finally {
    globalThis.fetch = real;
  }
});

test('the group check passes a clean two-PR group without building anything', async () => {
  const r = repo();
  try {
    const g = twoPrGroup(r);
    const { problems, notes } = await check(r, g);
    assert.deepEqual(problems, []);
    assert.ok(notes.some((n) => /^alpha: ladder-merge would publish: .*host-alpha-pr11 artifact 2011/.test(n)), notes.join('\n'));
    assert.ok(notes.some((n) => /^beta: ladder-merge would publish: .*host-beta-pr12 artifact 2012/.test(n)), notes.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('NEGATIVE: two queued PRs touching one package fail the group', async () => {
  const r = repo();
  try {
    const { problems } = await check(r, twoPrGroup(r, { samepackage: true }));
    assert.ok(problems.some((p) => /^alpha: touched by #11 and #12 in one group/.test(p)), problems.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('NEGATIVE: a package whose tree changed on main since its PR was built fails the group', async () => {
  const r = repo();
  try {
    const a = branch(r, 'bb/a', r.base, () => r.pkg('alpha', '1.0.0-2'));
    r.put('packages/alpha/build.sh', 'make\n');
    const moved = r.commit('main moves alpha');
    const b = branch(r, 'bb/b', moved, () => r.put('README.md', 'docs\n'));
    const m1 = queueMerge(r, moved, a, 11, 'bb/a');
    const m2 = queueMerge(r, m1, b, 12, 'bb/b');
    const cwd = process.cwd();
    process.chdir(r.dir);
    let got;
    try {
      got = await checkGroup(
        {
          head: m2,
          members: groupMembers(moved, m2, r.git),
          touched: touchedOf(r),
          digest: treeDigester(r.git),
          owners: (pkg) => touchingCommit(pkg, moved, m2),
          context: (pkg, m) => readCtx(r, pkg, m.commit),
        },
        groupIo(r, { a, b }),
      );
    } finally {
      process.chdir(cwd);
    }
    assert.ok(got.problems.some((p) => /^alpha: its tree in the group head .* is not the tree #11's artifact was built from/.test(p)), got.problems.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('NEGATIVE: a PR whose head moved after it was queued fails the group', async () => {
  const r = repo();
  try {
    const g = twoPrGroup(r);
    const { problems } = await check(r, g, { prs: { 12: { state: 'open', head: { sha: 'c'.repeat(40) } } } });
    assert.ok(problems.some((p) => p === `#12's head is ${'c'.repeat(40)}, but the group merged ${g.b}`), problems.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('NEGATIVE: a queued package PR whose cert-review is not green fails the group', async () => {
  const r = repo();
  try {
    const g = twoPrGroup(r);
    const { problems } = await check(r, g, { 12: { reviewState: 'failure' } });
    assert.ok(problems.some((p) => p.startsWith(`#12: the cert-review status on its head ${g.b} is failure`)), problems.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('NEGATIVE: a commit that is not a queue merge commit fails closed', () => {
  const r = repo();
  try {
    r.put('x', '1');
    const direct = r.commit('direct push');
    assert.throws(() => groupMembers(r.base, direct, r.git), /is not a two-parent "Merge pull request #N" commit/);
  } finally {
    r.cleanup();
  }
});

test('the group runs the kernel-compat proof exactly when the proof workflow\'s own paths are touched', () => {
  const paths = proofPaths(readFileSync(join(ROOT, '.github/workflows/kernel-compat-proof.yml'), 'utf8'));
  assert.ok(paths.includes('package.json') && paths.includes('scripts/browser-cert/page/**'), paths.join(', '));
  const res = paths.map(globRegExp);
  assert.ok(res.some((re) => re.test('scripts/browser-cert/page/x/y.mjs')));
  assert.ok(!res.some((re) => re.test('packages/alpha/recipe.yaml')));
});

test('ladder-pr on a merge group publishes, pushes and uploads nothing', () => {
  const yaml = readFileSync(join(ROOT, '.github/workflows/ladder-pr.yml'), 'utf8');
  assert.match(yaml, /^on:\n {2}pull_request:\n {2}merge_group:\n/m);
  const body = yaml.slice(yaml.indexOf('\njobs:\n'));
  const jobs = body.split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/).slice(1);
  assert.ok(jobs.length > 10, 'parsed the jobs');
  for (const job of jobs) {
    const name = job.match(/^ {2}([a-z0-9-]+):/)[1];
    if (/upload-artifact|git push|contents: write|id-token|npm publish/.test(job)) {
      const cond = job.match(/^ {4}if: (.+)$/m)?.[1] ?? '';
      const gated = cond.includes("github.event_name == 'pull_request'") || /needs\.(recipe-sha|host-build)\.result == 'success'/.test(cond);
      assert.ok(gated, `${name} writes something but its if (${cond || 'none'}) does not keep it to pull_request`);
    }
  }
  const ci = jobs.find((j) => j.startsWith('  ci:'));
  assert.match(ci, /^ {4}name: \$\{\{ github\.event_name == 'workflow_dispatch' && 'ci \(group dry run\)' \|\| 'ci' \}\}$/m, 'a dry run never reports under the required ci name');
  const compat = jobs.find((j) => j.startsWith('  kernel-compat:'));
  assert.match(compat, /^ {4}if: github\.event_name == 'merge_group' && /m, 'only a real merge group sends its head to kernel-compat (whose pool gate trusts dispatches on main)');
  for (const writer of ['recipe-sha', 'host-build', 'rebuild']) {
    const job = jobs.find((j) => j.startsWith(`  ${writer}:`));
    assert.match(job, /^ {4}if: github\.event_name == 'pull_request' && /m, `${writer} runs only on pull_request`);
  }
});

test('ladder-automerge hands a qualifying PR to the queue (auto-merge, merge commit, at the decided head) and merges nothing itself', async () => {
  const { merge, AUTO_MERGE, ENQUEUE } = await import('../ladder-automerge.mjs');
  const head = 'd'.repeat(40);
  const calls = [];
  const pr = {
    number: 11, node_id: 'PR_11', merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'clean', changed_files: 1,
    head: { sha: head, repo: { full_name: 'x/y' } }, base: { ref: 'main', sha: 'e'.repeat(40) }, labels: [],
  };
  const io = (queueOn, gqlError) => ({
    ...memberIo({ number: 11, head, sha: SHA_A, pkg: 'alpha', version: '1.0.0-2' }),
    pull: async () => pr,
    files: async () => [{ filename: 'packages/alpha/recipe.yaml' }],
    file: async () => 'version: 1.0.1\n',
    ladderRun: async () => ({ run: { id: 1, status: 'completed', conclusion: 'success' }, jobs: [{ name: 'ci', conclusion: 'success' }] }),
    mergeQueue: async (branch) => (calls.push(['mergeQueue', branch]), queueOn),
    gql: async (q, vars) => {
      calls.push([q === AUTO_MERGE ? 'auto-merge' : q === ENQUEUE ? 'enqueue' : 'other', vars]);
      if (q === AUTO_MERGE && gqlError) throw new Error(gqlError);
      return {};
    },
    mergePull: async () => (calls.push(['PUT merge']), { sha: 'f'.repeat(40) }),
    commit: async () => ({ parents: [{ sha: 'e'.repeat(40) }] }),
  });
  const queued = await merge({ repo: 'x/y', number: 11, head }, io(true));
  assert.equal(queued.queued, true);
  assert.equal(queued.merged, false, 'no merge sha: the publish waits for the queue\'s push to main');
  assert.deepEqual(calls, [['mergeQueue', 'main'], ['auto-merge', { id: 'PR_11', head }]]);

  calls.length = 0;
  await merge({ repo: 'x/y', number: 11, head }, io(true, 'GraphQL: Pull request is in clean status (enablePullRequestAutoMerge)'));
  assert.deepEqual(calls.map((c) => c[0]), ['mergeQueue', 'auto-merge', 'enqueue']);

  calls.length = 0;
  await assert.rejects(merge({ repo: 'x/y', number: 11, head }, io(true, 'GraphQL: Head sha didn\'t match expected head')), /Head sha/);
  assert.ok(!calls.some((c) => c[0] === 'PUT merge'), 'a refused enqueue never falls back to a direct merge');

  calls.length = 0;
  const direct = await merge({ repo: 'x/y', number: 11, head }, io(false));
  assert.deepEqual(direct, { merged: true, sha: 'f'.repeat(40), before: 'e'.repeat(40) });
  assert.deepEqual(calls.map((c) => c[0]), ['mergeQueue', 'PUT merge'], 'without a queue it merges as before');
});

test('ladder-automerge: under a merge queue a mergeable PR that is "blocked" (direct merges are) still qualifies; without a queue it does not', async () => {
  const { mergeProblems } = await import('../ladder-automerge.mjs');
  const pr = {
    number: 11, merged: false, state: 'open', draft: false, mergeable: true, mergeable_state: 'blocked', changed_files: 1,
    head: { sha: 'd'.repeat(40), repo: { full_name: 'x/y' } }, base: { ref: 'main' }, labels: [],
  };
  const args = { repo: 'x/y', pr, review: { state: 'success' }, ladder: { run: { status: 'completed', conclusion: 'success' }, jobs: [{ name: 'ci', conclusion: 'success' }] }, files: [{ filename: 'packages/alpha/recipe.yaml' }], majors: [] };
  assert.deepEqual(mergeProblems({ ...args, queue: true }), []);
  assert.deepEqual(mergeProblems(args), ['mergeable_state is blocked']);
  assert.deepEqual(mergeProblems({ ...args, queue: true, pr: { ...pr, mergeable_state: 'dirty', mergeable: false } }), ['mergeable_state is dirty (merge queue)']);
});
