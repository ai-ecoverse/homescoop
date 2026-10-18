// cert-review files no duplicate issues (PM decision, 2026-10-18): file-issue.mjs, the gh shim and
// the issue-dedupe after-run check, against a mocked GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseOf, fileIssue, keyIn, keyOf, kernelLine, main as fileMain, packageOf } from '../cert-review/file-issue.mjs';
import { refusal } from '../cert-review/gh-shim.mjs';
import { check, main as dedupeMain } from '../cert-review/issue-dedupe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOT = 'github-actions[bot]';

// An in-memory repository with the calls file-issue.mjs makes.
function fakeGitHub(issues = []) {
  const state = { issues: issues.map((i) => ({ comments: [], ...i })), next: 1000 };
  return {
    state,
    async openIssues() {
      return state.issues.filter((i) => i.state === 'open');
    },
    async comment(number, body) {
      state.issues.find((i) => i.number === number).comments.push(body);
    },
    async create({ title, body, labels }) {
      const issue = { number: state.next++, title, body, labels, state: 'open', comments: [], user: { login: BOT }, created_at: new Date().toISOString() };
      state.issues.push(issue);
      return issue;
    },
  };
}

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cert-file-issue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function file(gh, t, over = {}) {
  const dir = scratch(t);
  const body = join(dir, 'body.md');
  writeFileSync(body, over.body ?? 'repro: run flock.mjs\n');
  const lines = [];
  const args = [
    '--package', over.package ?? 'wasix-ruby',
    '--case', over.case ?? 'cert/flock.mjs:LOCK_EX on a read-only handle',
    ...(over.kernel ? ['--kernel', over.kernel] : []),
    '--title', over.title ?? '[cert] wasix-ruby: File#flock raises EBADF on a read-only handle',
    '--body-file', body,
    '--label', 'next-build',
  ];
  const env = { RUN_URL: over.run ?? 'https://github.com/ai-ecoverse/homescoop/actions/runs/1', PR_NUMBER: over.pr ?? '11', GH_REPO: 'ai-ecoverse/homescoop' };
  const code = await fileMain(args, { gh, env, root: ROOT, out: (l) => lines.push(l), err: () => {} });
  assert.equal(code, 0);
  return lines.at(-1);
}

test('the key: package, case and kernel line normalise; a kernel patch release keeps the key', () => {
  assert.equal(packageOf('@ai-ecoverse/wasm-bash', ROOT), 'bash');
  assert.equal(packageOf('wasm-bash', ROOT), 'bash');
  assert.equal(packageOf('wasi-uv', ROOT), 'wasi-uv');
  assert.equal(caseOf('packages/x/cert/flock.mjs:  LOCK_EX   on a\tRead-only handle '), 'flock:lock_ex on a read-only handle');
  assert.equal(caseOf('flock:lock_ex on a read-only handle'), 'flock:lock_ex on a read-only handle');
  assert.equal(kernelLine('@ai-ecoverse/slicc-kernel@1.122.2'), '1.122');
  assert.equal(kernelLine('1.122.5'), '1.122');
  assert.equal(kernelLine('1.123'), '1.123');
  assert.equal(kernelLine(undefined), 'any');
  assert.throws(() => kernelLine('latest'), /not a slicc-kernel version/);
  const k = (kernel) => keyOf({ pkg: 'bash', kase: 'jobs:wait', kernel: kernelLine(kernel) });
  assert.equal(k('1.122.2'), k('1.122.9'));
  assert.notEqual(k('1.122.2'), k('1.123.0'));
  assert.match(k(), /^v1 [0-9a-f]{16}$/);
});

test('the same failure twice gives one issue, and one comment with the second run\'s link, PR and version', async (t) => {
  const gh = fakeGitHub();
  const first = await file(gh, t, { run: 'https://example/runs/1', pr: '11' });
  const second = await file(gh, t, { run: 'https://example/runs/2', pr: '12', case: 'flock: LOCK_EX on a read-only handle', title: '[cert] wasix-ruby: worded differently' });
  assert.equal(first, second, 'the second run cites the first issue');
  assert.equal(gh.state.issues.length, 1);
  const [issue] = gh.state.issues;
  assert.ok(keyIn(issue.body), 'the issue carries the marker');
  assert.match(issue.body, /<!-- cert-review-key: v1 [0-9a-f]{16} -->/);
  for (const [, inner] of issue.body.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!inner.includes('--'), `an HTML comment can't hold "--": ${inner}`);
  assert.match(issue.body, /run https:\/\/example\/runs\/1, PR #11, wasix-ruby@\d/);
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0], /^Seen again by cert-review: run https:\/\/example\/runs\/2, PR #12, wasix-ruby@\S+\./);
});

test('a different case or kernel line gives a second issue; the same kernel line does not', async (t) => {
  const gh = fakeGitHub();
  const a = await file(gh, t, { kernel: '1.106.2' });
  const b = await file(gh, t, { kernel: '1.106.4' });
  assert.equal(a, b);
  const c = await file(gh, t, { kernel: '1.120.2' });
  assert.notEqual(c, a);
  const d = await file(gh, t, { kernel: '1.106.2', case: 'flock:pipe ends' });
  assert.notEqual(d, a);
  assert.notEqual(d, c);
  const e = await file(gh, t, { kernel: '1.106.2', package: 'wasix-perl', title: '[cert] wasix-perl: same case, other package' });
  assert.equal(new Set([a, c, d, e]).size, 4);
  assert.equal(gh.state.issues.length, 4);
});

test('a closed issue with the key gives a new issue, not a comment on the closed one', async (t) => {
  const gh = fakeGitHub();
  const first = await file(gh, t);
  gh.state.issues[0].state = 'closed';
  const second = await file(gh, t);
  assert.notEqual(second, first);
  assert.equal(gh.state.issues.length, 2);
  assert.equal(gh.state.issues[0].comments.length, 0);
  assert.equal(keyIn(gh.state.issues[0].body), keyIn(gh.state.issues[1].body));
});

test('file-issue refuses a title without [cert] and an empty body', async () => {
  const gh = fakeGitHub();
  const base = { pkg: 'bash', kase: 'x:y', kernel: 'any' };
  await assert.rejects(fileIssue(gh, { ...base, title: 'bash: no tag', body: 'b' }), /must start with "\[cert\]/);
  await assert.rejects(fileIssue(gh, { ...base, title: '[cert] bash: x', body: ' ' }), /empty/);
  assert.equal(gh.state.issues.length, 0);
});

test('the gh shim refuses a direct gh issue create (and gh api POSTs that create issues), passes the rest through', (t) => {
  assert.ok(refusal(['issue', 'create', '--title', 'x', '--body', 'y']));
  assert.ok(refusal(['-R', 'ai-ecoverse/homescoop', 'issue', 'create', '-t', 'x']));
  assert.ok(refusal(['issue', '-R', 'a/b', 'create']));
  assert.ok(refusal(['api', 'repos/ai-ecoverse/homescoop/issues', '-f', 'title=x']));
  assert.ok(refusal(['api', '/repos/{owner}/{repo}/issues', '--method', 'POST', '--input', 'x.json']));
  assert.ok(refusal(['api', '-X', 'POST', 'repos/a/b/issues/']));
  assert.ok(refusal(['api', 'graphql', '-f', 'query=mutation { createIssue(input: {}) { issue { number } } }']));
  assert.ok(refusal(['issue', 'new', '--title', '[cert] x: y']), 'gh issue new is an alias of create');
  const gq = scratch(t);
  writeFileSync(join(gq, 'm.graphql'), 'mutation { createIssue(input: {repositoryId: "x", title: "y"}) { issue { number } } }');
  writeFileSync(join(gq, 'q.graphql'), 'query { viewer { login } }');
  writeFileSync(join(gq, 'body.json'), JSON.stringify({ query: 'mutation { createIssue(input: {}) { issue { number } } }' }));
  assert.ok(refusal(['api', 'graphql', '-F', `query=@${join(gq, 'm.graphql')}`]), 'a mutation read from a file');
  assert.ok(refusal(['api', 'graphql', `-fquery=@${join(gq, 'm.graphql')}`]));
  assert.ok(refusal(['api', 'graphql', '--input', join(gq, 'body.json')]), 'a request body read from a file');
  assert.ok(refusal(['api', 'graphql', '--input', '-']), 'a request body read from stdin');
  assert.equal(refusal(['api', 'graphql', '-F', `query=@${join(gq, 'q.graphql')}`]), null, 'a file query that creates nothing');
  assert.equal(refusal(['issue', 'list', '--search', 'create']), null);
  assert.equal(refusal(['api', 'repos/a/b/issues?state=all']), null);
  assert.equal(refusal(['api', 'repos/a/b/issues/5/comments', '-f', 'body=x']), null);
  assert.equal(refusal(['run', 'view', '1', '--log-failed']), null);

  const dir = scratch(t);
  const real = join(dir, 'gh');
  writeFileSync(real, `#!/bin/sh\necho "real gh $*" >> "${join(dir, 'calls')}"\n`);
  chmodSync(real, 0o755);
  const shim = join(ROOT, 'scripts/cert-review/gh-shim.mjs');
  const env = { ...process.env, CERT_REVIEW_REAL_GH: real };
  const refused = spawnSync(process.execPath, [shim, 'issue', 'create', '--title', '[cert] x: y', '--body', 'z'], { env, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /refused here.*file-issue\.mjs/s);
  const passed = spawnSync(process.execPath, [shim, 'issue', 'list', '--search', 'flock'], { env, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(readFileSync(join(dir, 'calls'), 'utf8'), 'real gh issue list --search flock\n', 'only the allowed call reached the real gh');
});

const RUN = 'https://github.com/ai-ecoverse/homescoop/actions/runs/77';
const SINCE = '2026-10-18T10:00:00Z';
const issue = (number, over) => ({ number, title: `[cert] bash: ${number}`, body: 'x', user: { login: BOT }, created_at: '2026-10-18T10:05:00Z', state: 'open', ...over });
const marked = (body = 'x') => `${body}\n<!-- cert-review-key: v1 0123456789abcdef -->`;

test('issue-dedupe fails on a marker-less [cert] issue the run opened, and passes when every one is marked', async () => {
  const bad = check([issue(1, { body: marked() }), issue(2)], { since: SINCE, run: RUN });
  assert.equal(bad.ok, false);
  assert.match(bad.line, /^issue-dedupe: FAIL #2 \(opened since this review started, by this or a concurrent cert-review run\): no cert-review-key marker/);
  const good = check([issue(1, { body: marked() })], { since: SINCE, run: RUN });
  assert.equal(good.ok, true);
  assert.match(good.line, /^issue-dedupe: PASS 1 issue\(s\)/);
  // Not this run's: before it started, someone else's, a pull request, a non-[cert] title that doesn't name the run.
  const other = check(
    [
      issue(3, { created_at: '2026-10-18T09:59:00Z' }),
      issue(4, { user: { login: 'trieloff' } }),
      issue(5, { pull_request: {} }),
      issue(6, { title: 'publish failed: @ai-ecoverse/wasm-bash@1' }),
    ],
    { since: SINCE, run: RUN }
  );
  assert.equal(other.ok, true, other.line);
  assert.match(other.line, /PASS 0 issue/);
  const named = check([issue(7, { title: 'no tag', body: `seen in ${RUN}` })], { since: SINCE, run: RUN });
  assert.equal(named.ok, false, 'an untagged issue that names this run counts too');
  assert.match(named.line, /#7 \(opened by this run\)/);

  // Concurrent reviews share the bot: an unmarked issue that names another run is that run's, not this one's.
  const OTHER = 'https://github.com/ai-ecoverse/homescoop/actions/runs/7788';
  const neighbour = check([issue(9, { body: `filed by ${OTHER}` }), issue(10, { body: marked(`run ${RUN}, PR #1`) })], { since: SINCE, run: RUN });
  assert.equal(neighbour.ok, true, neighbour.line);
  assert.match(neighbour.line, /PASS 1 issue\(s\).*#10/);
  assert.equal(check([issue(11, { body: `seen in ${RUN}7` })], { since: SINCE, run: RUN }).ok, true, '…/runs/777 is not …/runs/77');
  const anon = check([issue(12)], { since: SINCE, run: RUN });
  assert.equal(anon.ok, false, 'an unmarked [cert] issue that names no run still fails');
  assert.match(anon.line, /#12 \(opened since this review started, by this or a concurrent cert-review run\)/);

  const lines = [];
  const code = await dedupeMain(['--since', SINCE, '--run', RUN, '--repo', 'a/b'], { list: async () => [issue(8)], out: (l) => lines.push(l) });
  assert.equal(code, 1);
  assert.match(lines.at(-1), /^::error::issue-dedupe: FAIL #8/);
  const failedList = [];
  assert.equal(await dedupeMain(['--since', SINCE, '--run', RUN, '--repo', 'a/b'], { list: async () => { throw new Error('503'); }, out: (l) => failedList.push(l) }), 1);
  assert.match(failedList.at(-1), /^issue-dedupe: FAIL could not list/);
});

test('cert-review.yml: the agent gets the shim and file-issue.mjs, is warned of the check, and the check runs through gate.mjs', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/cert-review.yml'), 'utf8');
  assert.match(wf, /scripts\/cert-review\/gh-shim\.mjs" "\$@"/);
  assert.match(wf, /CERT_REVIEW_REAL_GH=\$real/);
  assert.match(wf, /REVIEW_STARTED=\$\(date -u/);
  assert.match(wf, /only through `node \$\{\{ github\.workspace \}\}\/\.cert-review-tools\/scripts\/cert-review\/file-issue\.mjs`/);
  assert.match(wf, /after the review an `issue-dedupe` check fails this job/);
  assert.doesNotMatch(wf, /Then `gh issue create`/);
  assert.match(wf, /node \.cert-review-tools\/scripts\/gate\.mjs issue-dedupe -- node \.cert-review-tools\/scripts\/cert-review\/issue-dedupe\.mjs/);
  const review = wf.slice(wf.indexOf('\n  review:'), wf.indexOf('\n  record:'));
  assert.ok(review.indexOf('id: verdict') < review.indexOf('gate.mjs issue-dedupe'), 'the check runs after the verdict artifact is uploaded, so it never changes it');
  const record = wf.slice(wf.indexOf('\n  record:'), wf.indexOf('\n  unfinished:'));
  assert.match(record, /if: always\(\) && needs\.plan\.outputs\.go == 'true' && needs\.review\.result != 'cancelled'/, 'a failed check still lets the record job decide the verdict');
});

test('coverage gaps: two gaps for one package give one issue and one comment that states the second gap', async (t) => {
  const gh = fakeGitHub();
  const a = await file(gh, t, { package: 'sed', case: 'coverage', title: '[cert] sed: cert coverage gaps', body: 'no spec checks -z\n', run: 'https://example/runs/1' });
  const b = await file(gh, t, { package: 'sed', case: 'coverage:no spec for w', title: '[cert] sed: worded differently', body: 'no spec checks the w command\n', run: 'https://example/runs/2', kernel: '1.122.2' });
  assert.equal(a, b);
  assert.equal(gh.state.issues.length, 1);
  const [issue] = gh.state.issues;
  assert.equal(issue.title, '[cert] sed: cert coverage gaps');
  assert.ok(issue.labels.includes('cert-coverage'));
  assert.equal(keyIn(issue.body), keyOf({ pkg: 'sed', kase: 'coverage', kernel: 'any' }));
  assert.match(issue.body, /no spec checks -z/);
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0], /^New coverage gap from cert-review: run https:\/\/example\/runs\/2, PR #11, sed@\S+\.\n\nno spec checks the w command/);
});

test('coverage gaps: --kind coverage needs no --case or --title; another package gets its own issue; a defect stays separate', async (t) => {
  const gh = fakeGitHub();
  const dir = scratch(t);
  const body = join(dir, 'gap.md');
  writeFileSync(body, 'no spec checks LOCK_NB\n');
  const out = [];
  await fileMain(['--kind', 'coverage', '--package', 'wasix-ruby', '--body-file', body], { gh, env: { GH_REPO: 'ai-ecoverse/homescoop' }, root: ROOT, out: (l) => out.push(l), err: () => {} });
  const ruby = out.at(-1);
  assert.equal(gh.state.issues[0].title, '[cert] wasix-ruby: cert coverage gaps');
  const perl = await file(gh, t, { package: 'wasix-perl', case: 'coverage', title: '[cert] wasix-perl: cert coverage gaps' });
  assert.notEqual(perl, ruby);
  const defect = await file(gh, t, { package: 'wasix-ruby' });
  assert.notEqual(defect, ruby);
  assert.equal(gh.state.issues.length, 3);
  assert.ok(!gh.state.issues[2].labels.includes('cert-coverage'));
  assert.notEqual(caseOf('coverage-notes:x'), 'coverage', 'only the spec name `coverage` collapses');
});

test('cert-review.yml: coverage findings go to the package coverage issue', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/cert-review.yml'), 'utf8');
  assert.match(wf, /--kind coverage --package <recipe dir> --body-file <file>/);
  assert.match(wf, /never a separate issue/);
});
