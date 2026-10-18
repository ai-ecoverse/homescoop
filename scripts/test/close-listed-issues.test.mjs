import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedIssues, mergedPr, prose, run } from '../close-listed-issues.mjs';

test('every number of a keyword list counts, not just the first (#1117)', () => {
  assert.deepEqual(listedIssues('Fixes #949, #1050, #1059, #975, #1057, #950.'), [949, 950, 975, 1050, 1057, 1059]);
  assert.deepEqual(listedIssues('Closes #205 and #538. Refs #859, #745.'), [205, 538]);
  assert.deepEqual(listedIssues('closes #730, #729'), [729, 730]);
  assert.deepEqual(listedIssues('Resolves: #1, & #2'), [1, 2]);
  assert.deepEqual(listedIssues('fixed ai-ecoverse/homescoop#12, #13'), [12, 13]);
});

test('NEGATIVE: refs, bare numbers, quotes and code name nothing', () => {
  assert.deepEqual(listedIssues('Refs #712, #966. Part of #211. See #5.'), []);
  assert.deepEqual(listedIssues('> Fixes #1, #2\nquoted'), []);
  assert.deepEqual(listedIssues('Run `fixes #3, #4` by hand.'), []);
  assert.deepEqual(listedIssues('```\nFixes #5, #6\n```\nnothing'), []);
  assert.deepEqual(listedIssues('the prefix fixes nothing; suffix #7'), []);
  assert.equal(prose('a\n```\nb\n```\nc'), 'a\n\nc');
});

test('the merged pull request comes from the merge commit message', () => {
  assert.equal(mergedPr('Merge pull request #1118 from ai-ecoverse/bb/python-28\n\nbody'), 1118);
  assert.equal(mergedPr('chore: something'), null);
});

function fake({ issues, body = 'Fixes #10, #11, #12', merged = true, base = 'main' }) {
  const calls = [];
  const call = async (path, opts = {}) => {
    calls.push(`${opts.method ?? 'GET'} ${path}`);
    if (path === '/commits/abc12345') return { commit: { message: 'Merge pull request #99 from ai-ecoverse/x' } };
    if (path === '/commits/def67890') return { commit: { message: 'direct push' } };
    if (path === '/pulls/99') return { merged_at: merged ? '2026-10-18T00:00:00Z' : null, base: { ref: base }, body };
    const m = /^\/issues\/(\d+)$/.exec(path);
    if (m && !opts.method) {
      if (!(m[1] in issues)) throw new Error(`GET ${path} returned 404`);
      return issues[m[1]];
    }
    return {};
  };
  return { call, calls };
}

test('closes the listed issues that are still open, with a comment, and leaves the closed ones alone', async () => {
  const { call, calls } = fake({ issues: { 10: { state: 'closed' }, 11: { state: 'open' }, 12: { state: 'open' } } });
  const lines = [];
  const r = await run({ repo: 'o/r', commits: ['abc12345', 'def67890'], call, out: (l) => lines.push(l) });
  assert.deepEqual(r.closed, [11, 12]);
  assert.ok(calls.includes('POST /issues/11/comments') && calls.includes('PATCH /issues/11'));
  assert.ok(!calls.includes('PATCH /issues/10'));
  assert.match(lines.at(-1), /^close-listed-issues: PASS closed #11, #12$/);
});

test('NEGATIVE: an unmerged PR, a PR into another branch, a pull-request number and a missing issue close nothing', async () => {
  for (const opts of [{ merged: false }, { base: 'release' }]) {
    const { call, calls } = fake({ issues: { 10: { state: 'open' }, 11: { state: 'open' }, 12: { state: 'open' } }, ...opts });
    const r = await run({ repo: 'o/r', commits: ['abc12345'], call, out: () => {} });
    assert.deepEqual(r.closed, []);
    assert.ok(!calls.some((c) => c.startsWith('PATCH')));
  }
  const { call } = fake({ issues: { 10: { state: 'open', pull_request: {} } }, body: 'Fixes #10, #13' });
  const r = await run({ repo: 'o/r', commits: ['abc12345'], call, out: () => {} });
  assert.deepEqual(r.closed, []);
  assert.deepEqual(r.skipped, ['#10 (a pull request)', '#13 (GET /issues/13 returned 404)']);
});

test('a dry run closes nothing', async () => {
  const { call, calls } = fake({ issues: { 10: { state: 'open' }, 11: { state: 'open' }, 12: { state: 'open' } } });
  const lines = [];
  await run({ repo: 'o/r', commits: ['abc12345'], dryRun: true, call, out: (l) => lines.push(l) });
  assert.ok(!calls.some((c) => c.startsWith('PATCH') || c.startsWith('POST')));
  assert.match(lines.at(-1), /would close #10, #11, #12/);
});
