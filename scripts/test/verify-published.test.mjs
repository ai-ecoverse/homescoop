import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { integrityOf, verifyPublished } from '../verify-published.mjs';
import { LABEL, labelsOf, reportFailure } from '../publish-failure-issue.mjs';

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

  // homescoop#686: a new 22 MB package took about 18 min to become visible.
  const minutes = (m) => m * 60000;
  const lag = (ms, then, intervalMs = 15000) => [...Array(Math.ceil(ms / intervalMs))].map(() => ({ status: 404 })).concat([then]);

  it('waits up to the window for a version that is not visible yet (18 min of 404, 1800 s window)', async () => {
    const c = clock(lag(minutes(18), { status: 200, integrity: want }), 1800000);
    assert.deepEqual(await verifyPublished(pkg, c), { ok: true, got: want });
    assert.equal(c.seen.at(-1), minutes(18));
  });

  it('fails the 18 min lag under the old 600 s window', async () => {
    const got = await verifyPublished(pkg, clock(lag(minutes(18), { status: 200, integrity: want }), 600000));
    assert.equal(got.ok, false);
    assert.match(got.reason, /did not appear on the registry within 600s \(last answer: 404\)/);
  });

  it('fails at once when the version becomes visible with another integrity, however long the window', async () => {
    const c = clock(lag(minutes(5), { status: 200, integrity: other }), 1800000);
    const got = await verifyPublished(pkg, c);
    assert.equal(got.ok, false);
    assert.equal(got.reason, `the registry serves ${other}, not ${want}`);
    assert.equal(c.seen.at(-1), minutes(5), 'no further polling after the wrong integrity');
  });

  it('fails when the version is still not visible past the 1800 s window', async () => {
    const c = clock([{ status: 404 }], 1800000);
    const got = await verifyPublished(pkg, c);
    assert.equal(got.ok, false);
    assert.equal(got.reason, '@ai-ecoverse/wasm-xxd@9.2.1186-1 did not appear on the registry within 1800s (last answer: 404)');
    assert.equal(c.seen.at(-1), 1800000);
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
    assert.deepEqual(io.calls.slice(1), [['label', LABEL], ['create', { title: 'publish-failure: x@1.0.0-1', body: 'b', labels: [LABEL, 'ci'] }]]);
  });

  it('labels a package failure with its area', () => {
    const packages = ['py-numpy', 'sed', 'wasix-sysroot'];
    assert.deepEqual(labelsOf('publish-failure: @ai-ecoverse/py-numpy@2.3.4-2', packages), [LABEL, 'ci', 'area:python']);
    assert.deepEqual(labelsOf('publish-failure: @ai-ecoverse/wasix-sysroot@2025.9.30-34', packages), [LABEL, 'ci', 'area:sysroot']);
    assert.deepEqual(labelsOf('publish-failure: @ai-ecoverse/wasm-sed@4.10-3', packages), [LABEL, 'ci']);
    assert.deepEqual(labelsOf('publish-failure: auto-merge of #12', packages), [LABEL, 'ci']);
  });

  it('comments on the open issue with the same title instead of opening another', async () => {
    const io = gh([{ number: 9, title: 'publish-failure: x@1.0.0-1' }, { number: 10, title: 'publish-failure: x@1.0.0-1', pull_request: {} }]);
    assert.deepEqual(await reportFailure({ title: 'publish-failure: x@1.0.0-1', body: 'again' }, io), { action: 'commented on', number: 9 });
    assert.deepEqual(io.calls.slice(1), [['comment', 9, 'again']]);
  });
});
