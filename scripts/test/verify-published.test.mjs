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

describe('dist-tags after a publish (homescoop#1150)', async () => {
  const { tagProblem, verifyTags } = await import('../verify-published.mjs');
  it('an untagged publish moves latest to the version (or a newer one raced past it)', () => {
    assert.equal(tagProblem({ version: '3.14.2-29', tag: 'latest' }, { latest: '3.14.2-29' }), '');
    assert.equal(tagProblem({ version: '3.14.2-29', tag: 'latest' }, { latest: '3.14.2-30' }), '');
  });
  it('a tagged publish puts its tag on the version and leaves latest alone', () => {
    assert.equal(tagProblem({ version: '3.15.0-1', tag: 'python3.15' }, { latest: '3.14.2-29', 'python3.15': '3.15.0-1' }), '');
  });
  it('NEGATIVE: the tag missing or behind, or latest on a tagged version, is a problem', () => {
    assert.match(tagProblem({ version: '3.15.0-1', tag: 'python3.15' }, { latest: '3.14.2-29' }), /no python3\.15 dist-tag/);
    assert.match(tagProblem({ version: '3.14.2-29', tag: 'latest' }, { latest: '3.14.2-28' }), /latest is 3\.14\.2-28, not 3\.14\.2-29/);
    assert.match(tagProblem({ version: '3.15.0-1', tag: 'python3.15' }, { latest: '3.15.0-1', 'python3.15': '3.15.0-1' }), /latest moved to 3\.15\.0-1/);
  });
  it('polls a lagging packument, but fails at once when latest landed on a tagged version', async () => {
    let t = 0;
    const answers = [{ status: 200, tags: { latest: '3.14.2-29' } }, { status: 503 }, { status: 200, tags: { latest: '3.14.2-29', 'python3.15': '3.15.0-1' } }];
    const ok = await verifyTags({ name: 'n', version: '3.15.0-1', tag: 'python3.15' }, { fetchTags: async () => answers.shift(), sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 60000, intervalMs: 15000 });
    assert.equal(ok.ok, true);
    assert.equal(t, 30000);
    t = 0;
    let calls = 0;
    const bad = await verifyTags({ name: 'n', version: '3.15.0-1', tag: 'python3.15' }, { fetchTags: async () => { calls++; return { status: 200, tags: { latest: '3.15.0-1', 'python3.15': '3.15.0-1' } }; }, sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 60000, intervalMs: 15000 });
    assert.equal(bad.ok, false);
    assert.equal(calls, 1);
    assert.match(bad.reason, /latest moved/);
  });
  it('NEGATIVE: a tag that never shows up fails after the timeout', async () => {
    let t = 0;
    const r = await verifyTags({ name: 'n', version: '3.15.0-1', tag: 'python3.15' }, { fetchTags: async () => ({ status: 200, tags: { latest: '3.14.2-29' } }), sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 60000, intervalMs: 15000 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no python3\.15 dist-tag/);
    assert.equal(t, 60000);
  });
});
