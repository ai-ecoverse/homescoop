import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { integrityOf, verifyPublished } from './verify-published.mjs';
import { LABEL, reportFailure } from './publish-failure-issue.mjs';

const want = integrityOf(Buffer.from('the published package.tgz'));
const other = integrityOf(Buffer.from('some other tarball'));

function clock(answers, timeoutMs = 60000, intervalMs = 15000) {
  let t = 0;
  const seen = [];
  return {
    seen,
    fetchVersion: async () => {
      seen.push(t);
      return answers.length > 1 ? answers.shift() : answers[0];
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    timeoutMs,
    intervalMs,
  };
}

describe('verifyPublished', () => {
  const pkg = { name: '@ai-ecoverse/wasm-xxd', version: '9.2.1186-1', integrity: want };

  it('computes npm\'s sha512 integrity', () => {
    assert.match(want, /^sha512-[A-Za-z0-9+/]{86}==$/);
  });

  it('passes when the registry serves the same sha512', async () => {
    assert.deepEqual(await verifyPublished(pkg, clock([{ status: 200, integrity: want }])), { ok: true, got: want });
  });

  it('waits out registry lag and transient errors', async () => {
    const c = clock([{ status: 404 }, { status: 'error fetch failed' }, { status: 503 }, { status: 200, integrity: want }]);
    assert.equal((await verifyPublished(pkg, c)).ok, true);
    assert.deepEqual(c.seen, [0, 15000, 30000, 45000]);
  });

  it('fails at once on a different integrity', async () => {
    const c = clock([{ status: 200, integrity: other }]);
    const got = await verifyPublished(pkg, c);
    assert.equal(got.ok, false);
    assert.equal(got.reason, `the registry serves ${other}, not ${want}`);
    assert.deepEqual(c.seen, [0]);
  });

  it('fails when the version never appears', async () => {
    const got = await verifyPublished(pkg, clock([{ status: 404 }], 600000, 15000));
    assert.equal(got.ok, false);
    assert.equal(got.reason, '@ai-ecoverse/wasm-xxd@9.2.1186-1 did not appear on the registry within 600s (last answer: 404)');
  });
});

describe('reportFailure', () => {
  function gh(open = []) {
    const calls = [];
    return {
      calls,
      openIssues: async (label) => (calls.push(['list', label]), open),
      comment: async (n, body) => calls.push(['comment', n, body]),
      ensureLabel: async (name) => calls.push(['label', name]),
      createIssue: async (issue) => (calls.push(['create', issue]), { number: 501 }),
    };
  }

  it('opens one labelled issue', async () => {
    const io = gh([{ number: 7, title: 'publish-failure: other@1.0.0-1' }]);
    assert.deepEqual(await reportFailure({ title: 'publish-failure: x@1.0.0-1', body: 'b' }, io), { action: 'opened', number: 501 });
    assert.deepEqual(io.calls.slice(1), [['label', LABEL], ['create', { title: 'publish-failure: x@1.0.0-1', body: 'b', labels: [LABEL] }]]);
  });

  it('comments on the open issue with the same title instead of opening another', async () => {
    const io = gh([{ number: 9, title: 'publish-failure: x@1.0.0-1' }, { number: 10, title: 'publish-failure: x@1.0.0-1', pull_request: {} }]);
    assert.deepEqual(await reportFailure({ title: 'publish-failure: x@1.0.0-1', body: 'again' }, io), { action: 'commented on', number: 9 });
    assert.deepEqual(io.calls.slice(1), [['comment', 9, 'again']]);
  });
});
