import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSING_ISSUES, closeLinkedIssues } from '../ladder-automerge.mjs';

const REPO = 'ai-ecoverse/homescoop';
const SHA = 'c'.repeat(40);

function client(nodes, { graphqlFails, closeFails = [] } = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, vars) {
      calls.push(['graphql', query, vars]);
      if (graphqlFails) throw new Error('HTTP 502');
      return { repository: { pullRequest: { closingIssuesReferences: { nodes } } } };
    },
    async gh(args) {
      calls.push(['gh', ...args]);
      if (closeFails.includes(args[2])) throw new Error('GraphQL: Resource not accessible by integration');
      return { stdout: '' };
    },
  };
}

const issue = (number, state = 'OPEN', repo = REPO) => ({ number, state, repository: { nameWithOwner: repo } });

test('closes only the still-open same-repo issues the merged PR links, with the merge in the comment', async () => {
  const io = client([issue(601), issue(602, 'CLOSED'), issue(675, 'OPEN', 'ai-ecoverse/slicc-kernel')]);
  const done = await closeLinkedIssues({ repo: REPO, number: 610, sha: SHA }, io);
  assert.deepEqual(done, {
    closed: [601],
    skipped: ['ai-ecoverse/homescoop#602: closed', 'ai-ecoverse/slicc-kernel#675: another repo'],
    warnings: [],
  });
  assert.deepEqual(io.calls, [
    ['graphql', CLOSING_ISSUES, { owner: 'ai-ecoverse', name: 'homescoop', pr: 610 }],
    ['gh', 'issue', 'close', '601', '--repo', REPO, '--comment', `Closed by #610 (merge ${SHA}), merged by ladder-automerge.`],
  ]);
  assert.match(CLOSING_ISSUES, /closingIssuesReferences/);
});

test('no linked issues closes nothing', async () => {
  const io = client([]);
  assert.deepEqual(await closeLinkedIssues({ repo: REPO, number: 610, sha: SHA }, io), { closed: [], skipped: [], warnings: [] });
  assert.equal(io.calls.filter(([c]) => c === 'gh').length, 0);
});

test('a close or lookup failure is a warning, never a throw', async () => {
  const io = client([issue(601), issue(603)], { closeFails: ['601'] });
  const done = await closeLinkedIssues({ repo: REPO, number: 610, sha: SHA }, io);
  assert.deepEqual(done.closed, [603]);
  assert.deepEqual(done.warnings, ['cannot close #601: GraphQL: Resource not accessible by integration']);
  const down = await closeLinkedIssues({ repo: REPO, number: 610, sha: SHA }, client([issue(601)], { graphqlFails: true }));
  assert.deepEqual(down, { closed: [], skipped: [], warnings: ['cannot read the issues PR #610 closes: HTTP 502'] });
  const odd = { ...client([]), graphql: async () => ({ repository: { pullRequest: null } }) };
  assert.match((await closeLinkedIssues({ repo: REPO, number: 610, sha: SHA }, odd)).warnings[0], /no closingIssuesReferences/);
});
