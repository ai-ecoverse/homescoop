import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CERT_REVIEW } from './ladder-merge-resolve.mjs';
import { MARKER, decide, isMajorBump, merge, mergeProblems, recipeVersion, reportSkip } from './ladder-automerge.mjs';

const REPO = 'ai-ecoverse/homescoop';
const HEAD = 'dafd27620000000000000000000000000000000a';
const BASE = '9bf557360000000000000000000000000000000b';
const RUN = 38800000001;
const REC = 12000000077;

const pull = (extra = {}) => ({
  number: 384,
  state: 'open',
  merged: false,
  draft: false,
  mergeable: true,
  mergeable_state: 'clean',
  labels: [],
  head: { sha: HEAD, repo: { full_name: REPO } },
  base: { sha: BASE, ref: 'main' },
  ...extra,
});

const green = () => ({ run: { id: 20, status: 'completed', conclusion: 'success' }, jobs: [{ name: 'ci', conclusion: 'success' }] });
const files = (...names) => names.map((filename) => ({ filename }));
const ok = { repo: REPO, pr: pull(), review: { state: 'success' }, ladder: green(), files: files('packages/wasix-ruby/package/package.json'), majors: [] };

function fakeIo({ pulls = [pull()], prFiles = files('packages/wasix-ruby/recipe.yaml'), recipes = {}, review = true, ladder = green(), mergeFails } = {}) {
  const calls = [];
  let n = 0;
  const record = { pr: 384, head: HEAD, ladder_run: 20, cert_review_run: RUN, lines: ['certified=x @ai-ecoverse/wasix-ruby 3.4.11-13'] };
  return {
    calls,
    sleep: async () => calls.push(['sleep']),
    pull: async () => pulls[Math.min(n++, pulls.length - 1)],
    files: async () => prFiles,
    file: async (path, ref) => recipes[`${ref}:${path}`],
    ladderRun: async () => ladder,
    statuses: async () =>
      review
        ? [{ context: 'cert-review', state: 'success', creator: { login: 'github-actions[bot]' }, target_url: `https://github.com/${REPO}/actions/runs/${RUN}/artifacts/${REC}`, description: `certified: run ${RUN}, record artifact ${REC}` }]
        : [],
    run: async () => ({ id: RUN, path: CERT_REVIEW, event: 'workflow_run', head_branch: 'main', status: 'completed', conclusion: 'success' }),
    artifact: async () => ({ id: REC, name: 'cert-review-record-384', expired: false, workflow_run: { id: RUN } }),
    record: async () => record,
    mergeQueue: async () => false,
    async mergePull(num, sha) {
      calls.push(['merge', num, sha]);
      if (mergeFails) throw Object.assign(new Error('PUT /pulls/384/merge returned 405'), { status: 405 });
      return { sha: 'cccccccccccccccccccccccccccccccccccccccc' };
    },
    commit: async () => ({ parents: [{ sha: BASE }, { sha: HEAD }] }),
    comments: async () => calls.filter(([c]) => c === 'comment').map(([, id, body]) => ({ id, body, user: { login: 'github-actions[bot]' } })),
    addComment: async (num, body) => calls.push(['comment', 1, body]),
    editComment: async (id, body) => calls.push(['edit', id, body]),
  };
}

describe('recipe versions and majors', () => {
  it('reads the recipe version and spots a semver major through npmify', () => {
    assert.equal(recipeVersion('name: x\n# renovate: ...\nversion: "3.4.11"\nnpm: "@x/y"\n'), '3.4.11');
    assert.equal(recipeVersion("version: '2.23'"), '2.23');
    assert.equal(isMajorBump('2.23', '3'), true);
    assert.equal(isMajorBump('9.2.1186', '9.2.1192'), false);
    assert.equal(isMajorBump('2.5.1', '3.0.0'), true);
    assert.equal(isMajorBump('3', '2.9'), false);
    assert.equal(isMajorBump(undefined, '1.0.0'), false);
    assert.equal(isMajorBump('weird', '1.0.0'), true);
  });
});

describe('mergeProblems', () => {
  it('merges an open same-repo PR on main with a green review, a green ci, publishable files and a clean state', () => {
    assert.deepEqual(mergeProblems(ok), []);
  });

  it('names every reason a PR stays human', () => {
    const cases = [
      [{ pr: pull({ merged: true }) }, /^already merged$/],
      [{ pr: pull({ state: 'closed' }) }, /PR #384 is closed/],
      [{ pr: pull({ draft: true }) }, /is a draft/],
      [{ pr: pull({ head: { sha: HEAD, repo: { full_name: 'someone/homescoop' } } }) }, /comes from a fork \(someone\/homescoop\)/],
      [{ pr: pull({ base: { sha: BASE, ref: 'bb/other' } }) }, /targets bb\/other, not main \(stacked\)/],
      [{ pr: pull({ labels: [{ name: 'homescoop-major' }] }) }, /labelled homescoop-major/],
      [{ majors: [{ pkg: 'pkgconf', from: '2.5.1', to: '3.0.0' }] }, /pkgconf recipe\.yaml goes 2\.5\.1 → 3\.0\.0, a semver major/],
      [{ review: { state: 'absent' } }, /the cert-review on dafd2762\S* is absent/],
      [{ review: { state: 'failure' } }, /is failure/],
      [{ review: { state: 'invalid', problem: 'run 1 ran on bb/x, not main' } }, /is invalid: run 1 ran on bb\/x, not main/],
      [{ ladder: null }, /no ladder-pr run at/],
      [{ ladder: { run: { id: 20, status: 'completed', conclusion: 'failure' }, jobs: [{ name: 'ci', conclusion: 'failure' }] } }, /concluded failure; ladder-pr's ci on the head is failure/],
      [{ ladder: { run: { id: 20, status: 'completed', conclusion: 'success' }, jobs: [] } }, /ci on the head is missing/],
      [{ files: files('packages/x/build.sh') }, /touches no publishable package file/],
      [{ pr: pull({ mergeable_state: 'blocked' }) }, /mergeable_state is blocked/],
      [{ pr: pull({ changed_files: 3001 }) }, /the file list stops at 1 of 3001 files/],
    ];
    for (const [over, why] of cases) assert.match(mergeProblems({ ...ok, ...over }).join('; '), why, why.source);
  });

  it('keeps the human-only paths human, renames included', () => {
    const human = [
      '.github/workflows/ladder-pr.yml',
      'scripts/sync-package-version.mjs',
      'scripts/emsdk-patches/0001.patch',
      'shims/slicc/slicc-uname.js',
      'crates/wasix-net/src/lib.rs',
      'renovate.json',
      'package.json',
    ];
    for (const path of human) {
      const problems = mergeProblems({ ...ok, files: files('packages/xxd/recipe.yaml', path) });
      assert.match(problems.join(), new RegExp(`touches ${path.replace(/[.*/]/g, '\\$&')}, which stay human`));
    }
    const renamed = [{ filename: 'packages/xxd/recipe.yaml' }, { filename: 'docs/x.md', previous_filename: 'scripts/x.mjs' }];
    assert.match(mergeProblems({ ...ok, files: renamed }).join(), /scripts\/x\.mjs, which stay human/);
    assert.deepEqual(mergeProblems({ ...ok, files: files('packages/xxd/recipe.yaml', 'packages/xxd/cert/meta.json', 'docs/a.md') }), []);
  });
});

describe('decide', () => {
  it('waits for mergeable to settle and checks the recipe versions against the base', async () => {
    const recipes = {
      [`${BASE}:packages/wasix-ruby/recipe.yaml`]: 'version: "3.4.11"\n',
      [`${HEAD}:packages/wasix-ruby/recipe.yaml`]: 'version: "3.4.11"\n',
    };
    const io = fakeIo({ pulls: [pull({ mergeable: null, mergeable_state: 'unknown' }), pull()], recipes });
    const got = await decide({ repo: REPO, number: 384 }, io);
    assert.deepEqual(got.problems, []);
    assert.equal(got.review.runId, RUN);
    assert.equal(io.calls.filter(([c]) => c === 'sleep').length, 1);
  });

  it('skips a major recipe bump and a PR without a cert-review', async () => {
    const recipes = {
      [`${BASE}:packages/wasix-ruby/recipe.yaml`]: 'version: "3.4.11"\n',
      [`${HEAD}:packages/wasix-ruby/recipe.yaml`]: 'version: "4.0.0"\n',
    };
    assert.match((await decide({ repo: REPO, number: 384 }, fakeIo({ recipes }))).problems.join(), /wasix-ruby recipe\.yaml goes 3\.4\.11 → 4\.0\.0/);
    assert.match((await decide({ repo: REPO, number: 384 }, fakeIo({ review: false }))).problems.join(), /cert-review on \S+ is absent/);
  });

  it('stops at an already merged PR, unless a dry run judges it as if open', async () => {
    const merged = { pulls: [pull({ merged: true, state: 'closed', mergeable_state: 'unknown' })], prFiles: files('packages/coreutils/package/package.json', 'shims/slicc/slicc-uname.js') };
    assert.deepEqual((await decide({ repo: REPO, number: 384 }, fakeIo(merged))).problems, ['already merged']);
    const asIfOpen = await decide({ repo: REPO, number: 384, asIfOpen: true }, fakeIo(merged));
    assert.match(asIfOpen.problems.join('; '), /touches shims\/slicc\/slicc-uname\.js, which stay human; mergeable_state is unknown/);
  });
});

describe('merge', () => {
  it('merges at the head with a merge commit and returns its first parent', async () => {
    const io = fakeIo();
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD }, io), { merged: true, sha: 'c'.repeat(40), before: BASE });
    assert.deepEqual(io.calls.find(([c]) => c === 'merge'), ['merge', 384, HEAD]);
  });

  it('re-runs every check right before the PUT', async () => {
    await assert.rejects(merge({ repo: REPO, number: 384, head: BASE }, fakeIo()), /moved from 9bf55736\S* to dafd2762/);
    const late = [
      [{ pulls: [pull({ mergeable_state: 'behind' })] }, /no longer qualifies right before the merge: mergeable_state is behind/],
      [{ pulls: [pull({ labels: [{ name: 'homescoop-major' }] })] }, /no longer qualifies .*labelled homescoop-major/],
      [{ review: false }, /no longer qualifies .*cert-review on \S+ is absent/],
      [{ ladder: null }, /no longer qualifies .*no ladder-pr run/],
    ];
    for (const [over, why] of late) {
      const io = fakeIo(over);
      await assert.rejects(merge({ repo: REPO, number: 384, head: HEAD }, io), why);
      assert.equal(io.calls.some(([c]) => c === 'merge'), false);
    }
  });

  it('treats a PR merged elsewhere as done, and any other failure as an error', async () => {
    const human = pull({ merged: true, merged_by: { login: 'trieloff' }, merge_commit_sha: 'd'.repeat(40) });
    const elsewhere = fakeIo({ pulls: [pull(), human], mergeFails: true });
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD }, elsewhere), { merged: false, reason: 'already merged' });
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD }, fakeIo({ pulls: [human] })), { merged: false, reason: 'already merged' });
    await assert.rejects(merge({ repo: REPO, number: 384, head: HEAD }, fakeIo({ mergeFails: true })), /returned 405/);
  });

  it('recovers its own merge when the PUT answer was lost, so the publish still runs', async () => {
    const ours = pull({ merged: true, state: 'closed', merged_by: { login: 'github-actions[bot]' }, merge_commit_sha: 'c'.repeat(40) });
    const lost = fakeIo({ pulls: [pull(), ours], mergeFails: true });
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD }, lost), { merged: true, sha: 'c'.repeat(40), before: BASE });
    const earlier = fakeIo({ pulls: [ours] });
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD }, earlier), { merged: true, sha: 'c'.repeat(40), before: BASE });
    assert.equal(earlier.calls.some(([c]) => c === 'merge'), false);
    const otherHead = fakeIo({ pulls: [pull(), ours], mergeFails: true });
    assert.deepEqual(await merge({ repo: REPO, number: 384, head: HEAD.replace('a', 'b') }, otherHead).catch((e) => e.message), `PR #384 moved from ${HEAD.replace('a', 'b')} to ${HEAD}`);
  });
});

describe('the skip comment', () => {
  it('adds one marked comment, then updates it', async () => {
    const io = fakeIo();
    assert.equal(await reportSkip(384, 'it touches shims/slicc/x.c, which stay human', io), 'added');
    assert.equal(await reportSkip(384, 'PR #384 is a draft', io), 'updated');
    assert.deepEqual(io.calls.map(([c, id]) => [c, id]), [['comment', 1], ['edit', 1]]);
    assert.equal(io.calls[1][2], `${MARKER}\nauto-merge skipped: PR #384 is a draft\n`);
  });
});
