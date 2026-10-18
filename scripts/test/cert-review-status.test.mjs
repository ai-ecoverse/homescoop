import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT, LIMIT, STATES, failIfOurs, groupStatus, ownedBy, planStatus } from '../cert-review/status.mjs';
import { reportStatus } from '../merge-group-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const PARENT = 'c'.repeat(40);

function workflow(name) {
  return readFileSync(join(ROOT, '.github/workflows', name), 'utf8');
}

function stepScript(file, marker) {
  const lines = workflow(file).split('\n');
  const at = lines.findIndex((l) => l.trim() === marker);
  assert.ok(at >= 0, marker);
  const start = lines.findIndex((l, i) => i > at && l.trim() === 'script: |');
  const indent = lines[start + 1].match(/^ */)[0];
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith(indent)) break;
    body.push(l.slice(indent.length));
  }
  return body.join('\n');
}

const planScript = () => stepScript('cert-review.yml', 'id: plan');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const ENV = { NUMBER: '7', LADDER_RUN: '900', LADDER_ATTEMPT: '1', RUN_HEAD_SHA: H, RUN_HEAD_BRANCH: 'bb/x', RUN_HEAD_OWNER: 'ai-ecoverse' };

function world(over = {}) {
  return {
    repo: 'ai-ecoverse/homescoop',
    pr: { number: 7, head: H, fork: false },
    commit: { sha: H, author: 'trieloff', parents: [PARENT], message: 'feat: x' },
    run: { id: 900, head_sha: H, status: 'completed', conclusion: 'success', run_attempt: 1 },
    artifacts: ['host-alpha-pr7'],
    fail: null,
    ...over,
    env: { ...ENV, ...over.env },
  };
}

async function runPlan(w) {
  const statuses = [];
  const outputs = {};
  const [owner, repo] = w.repo.split('/');
  const pullOf = (p) => ({
    number: p.number,
    head: { sha: p.head, repo: { full_name: p.fork ? 'someone/homescoop' : w.repo } },
    base: { sha: 'd'.repeat(40) },
  });
  const github = {
    paginate: async (fn, args) => fn(args).then((r) => r.data),
    rest: {
      pulls: {
        get: async () => {
          if (w.fail === 'pulls') throw new Error('pulls.get 502');
          return { data: pullOf(w.pr) };
        },
        list: async ({ head }) => ({ data: w.pr && head === `${w.env.RUN_HEAD_OWNER}:${w.env.RUN_HEAD_BRANCH}` ? [pullOf(w.pr)] : [] }),
      },
      repos: {
        getCommit: async () => ({
          data: { sha: w.commit.sha, author: { login: w.commit.author }, parents: w.commit.parents.map((sha) => ({ sha })), commit: { message: w.commit.message } },
        }),
        createCommitStatus: async (s) => {
          assert.equal(s.owner, owner);
          assert.equal(s.repo, repo);
          statuses.push(s);
        },
      },
      actions: {
        getWorkflowRun: async () => ({ data: w.run }),
        listWorkflowRuns: async ({ head_sha }) => ({ data: { workflow_runs: w.run && w.run.head_sha === head_sha ? [w.run] : [] } }),
        listWorkflowRunArtifacts: async () => {
          if (w.fail === 'artifacts') throw new Error('artifacts 500');
          return { data: w.artifacts.map((name, i) => ({ id: 100 + i, name, digest: `sha256:${String(i).repeat(64)}`, expired: false })) };
        },
      },
    },
  };
  const core = { info() {}, notice() {}, setOutput: (k, v) => (outputs[k] = v) };
  const env = { GITHUB_WORKSPACE: ROOT, RUN_URL: 'https://github.com/ai-ecoverse/homescoop/actions/runs/1', ...w.env };
  const fakeProcess = { env };
  const fn = new AsyncFunction('github', 'context', 'core', 'process', planScript());
  await fn(github, { repo: { owner, repo } }, core, fakeProcess);
  return { statuses, outputs, final: statuses.at(-1) };
}

test('planStatus: each case maps to its state and description', () => {
  const base = { sha: H, head: H, number: 7, ladder: 'success', packages: ['alpha'] };
  const rows = [
    [{}, 'pending', /^reviewing alpha$/, true],
    [{ packages: [] }, 'success', /^no package built$/, false],
    [{ ladder: 'failure' }, 'failure', /^ladder-pr didn't pass \(failure\)$/, true],
    [{ ladder: 'failure', packages: [] }, 'failure', /^ladder-pr didn't pass/, false],
    [{ ladder: 'cancelled' }, 'failure', /\(cancelled\)/, false],
    [{ fork: true }, 'failure', /^fork PRs aren't certified$/, false],
    [{ fork: true, packages: [] }, 'success', /^no package built$/, false],
    [{ fork: true, ladder: 'failure' }, 'failure', /^ladder-pr didn't pass/, false],
    [{ ladder: null }, 'failure', /^no completed ladder-pr run/, false],
    [{ number: 0 }, 'failure', /^no open pull request/, false],
    [{ error: 'boom' }, 'failure', /^cert-review plan failed: boom$/, false],
    [{ moved: true }, null, /moved on/, false],
    [{ superseded: true }, null, /newer attempt/, false],
    [{ sha: null }, null, /no commit/, false],
  ];
  for (const [over, state, description, go] of rows) {
    const d = planStatus({ ...base, ...over });
    assert.equal(d.state, state, JSON.stringify(over));
    assert.match(d.description, description, JSON.stringify(over));
    assert.equal(d.go, go, JSON.stringify(over));
  }
});

test('planStatus is exhaustive: every combination posts a status, unless a newer run owns the head', () => {
  const pick = { error: [undefined, 'x'], sha: [null, H], number: [0, 7], fork: [false, true], moved: [false, true], superseded: [false, true], ladder: [null, 'success', 'failure', 'cancelled', 'action_required', 'timed_out'], packages: [[], ['alpha'], ['alpha', 'beta']] };
  let combos = [{}];
  for (const [k, vs] of Object.entries(pick)) combos = combos.flatMap((c) => vs.map((v) => ({ ...c, [k]: v })));
  assert.equal(combos.length, 2 * 2 * 2 * 2 * 2 * 2 * 6 * 3);
  for (const f of combos) {
    const d = planStatus(f);
    const why = JSON.stringify(f);
    if (d.state === null) assert.ok(!f.sha || (!f.error && (f.moved || f.superseded)), why);
    else assert.ok(STATES.includes(d.state), why);
    assert.ok(d.description.length > 0 && d.description.length <= LIMIT, why);
    if (d.go) assert.ok(['success', 'failure'].includes(f.ladder) && !f.fork && f.packages.length > 0 && f.sha && f.number && !f.error && !f.moved && !f.superseded, why);
    if (d.state === 'success') assert.ok(f.ladder === 'success' && !f.packages.length && !f.error, why);
    if (f.fork && f.packages.length) assert.notEqual(d.state, 'success', why);
    if (f.ladder !== 'success' && f.sha && !f.error && !f.moved && !f.superseded && f.number) assert.equal(d.state, 'failure', why);
  }
});

test('the plan script: every exit goes through finish(), which posts the planStatus decision', () => {
  const s = planScript();
  const returns = s.match(/\breturn\b[^\n]*/g);
  assert.ok(returns.length >= 6);
  for (const r of returns) {
    if (r.startsWith('return;')) continue;
    assert.match(r, /^return await finish\(\);$/, r);
  }
  assert.equal(s.match(/planStatus\(/g).length, 1);
  assert.equal(s.match(/setOutput\('go'/g).length, 1);
  assert.doesNotMatch(s, /\bskip\(/);
  assert.match(s, /catch \(err\) \{\s*facts\.error = err\.message;\s*return await finish\(\);/);
});

test('plan: a package PR goes pending, then hands the review on', async () => {
  const { statuses, outputs } = await runPlan(world());
  assert.deepEqual(statuses.map((s) => s.state), ['pending', 'pending']);
  assert.equal(statuses[0].description, 'cert-review plan started');
  assert.equal(statuses[1].description, 'reviewing alpha');
  assert.ok(statuses.every((s) => s.sha === H && s.context === CONTEXT));
  assert.equal(outputs.go, 'true');
  assert.equal(outputs.head, H);
  assert.equal(outputs.packages, '["alpha"]');
  assert.equal(outputs.ladder_run, '900');
  assert.deepEqual(JSON.parse(outputs.artifacts), [{ name: 'host-alpha-pr7', id: 100, digest: `sha256:${'0'.repeat(64)}` }]);
});

test('plan: two host-<pkg>-prN artifacts with one name fail the plan, nothing is reviewed', async () => {
  const { final, outputs } = await runPlan(world({ artifacts: ['host-alpha-pr7', 'host-alpha-pr7'] }));
  assert.equal(final.state, 'failure');
  assert.match(final.description, /host-alpha-pr7: 2 artifacts with that name/);
  assert.equal(outputs.go, 'false');
});

test('plan: a PR that built no package gets success "no package built"', async () => {
  const { final, outputs } = await runPlan(world({ artifacts: ['host-alpha-pr8', 'something-else'] }));
  assert.equal(final.state, 'success');
  assert.equal(final.description, 'no package built');
  assert.equal(outputs.go, 'false');
});

test('plan: ladder-pr not success is failure, and a package PR is still reviewed', async () => {
  for (const conclusion of ['failure', 'cancelled', 'action_required']) {
    const { final, outputs } = await runPlan(world({ run: { ...world().run, conclusion } }));
    assert.equal(final.state, 'failure', conclusion);
    assert.equal(final.description, `ladder-pr didn't pass (${conclusion})`);
    assert.equal(outputs.go, conclusion === 'failure' ? 'true' : 'false', conclusion);
  }
  const { final, outputs } = await runPlan(world({ run: { ...world().run, conclusion: 'failure' }, artifacts: [] }));
  assert.equal(final.state, 'failure');
  assert.equal(outputs.go, 'false');
});

test('plan: a head that moved on gets no status; the new head posts its own', async () => {
  const { statuses, outputs } = await runPlan(world({ pr: { number: 7, head: OLD.replace(/b/g, 'e'), fork: false }, commit: { sha: 'e'.repeat(40), author: 'trieloff', parents: [H], message: 'x' } }));
  assert.deepEqual(statuses, []);
  assert.equal(outputs.go, 'false');
});

test('plan: ladder-pr\'s recipe-sha commit on top of the built head is the head that gets the status', async () => {
  const bot = 'f'.repeat(40);
  const w = world({ pr: { number: 7, head: bot, fork: false }, commit: { sha: bot, author: 'github-actions[bot]', parents: [H], message: 'chore: refresh recipe sha256 and package version' } });
  const { statuses, outputs } = await runPlan(w);
  assert.ok(statuses.length && statuses.every((s) => s.sha === bot));
  assert.equal(outputs.head, bot);
});

test('plan: a re-run of the ladder-pr run supersedes this one, and nothing is posted', async () => {
  for (const run of [{ ...world().run, run_attempt: 2 }, { ...world().run, status: 'in_progress', conclusion: null }]) {
    const { statuses, outputs } = await runPlan(world({ run }));
    assert.deepEqual(statuses, []);
    assert.equal(outputs.go, 'false');
  }
});

test('plan: a fork PR (no pull_requests in the event) is found by branch; a package is failure, no package is success', async () => {
  const fork = { pr: { number: 9, head: H, fork: true }, env: { NUMBER: '', RUN_HEAD_OWNER: 'someone' } };
  const built = await runPlan(world({ ...fork, artifacts: ['host-alpha-pr9'] }));
  assert.equal(built.final.state, 'failure');
  assert.equal(built.final.description, "fork PRs aren't certified");
  assert.equal(built.outputs.go, 'false');
  const none = await runPlan(world({ ...fork, artifacts: [] }));
  assert.equal(none.final.state, 'success');
  assert.equal(none.final.description, 'no package built');
});

test('plan: no open pull request for the run is failure on the run\'s head', async () => {
  const { final } = await runPlan(world({ pr: null, env: { NUMBER: '' } }));
  assert.equal(final.state, 'failure');
  assert.equal(final.sha, H);
  assert.match(final.description, /^no open pull request has head/);
});

test('plan: an API error fails closed with a failure status', async () => {
  for (const fail of ['pulls', 'artifacts']) {
    const { final, outputs } = await runPlan(world({ fail }));
    assert.equal(final.state, 'failure', fail);
    assert.match(final.description, /^cert-review plan failed: /);
    assert.equal(final.sha, H);
    assert.equal(outputs.go, 'false');
  }
});

test('plan: a dispatched replay of an earlier head posts on that head', async () => {
  const { statuses, outputs } = await runPlan(world({ env: { NUMBER: '7', LADDER_RUN: '', LADDER_ATTEMPT: '', RUN_HEAD_SHA: '', RUN_HEAD_BRANCH: '', RUN_HEAD_OWNER: '', HEAD_SHA: H }, pr: { number: 7, head: OLD, fork: false } }));
  assert.ok(statuses.every((s) => s.sha === H));
  assert.equal(statuses.at(-1).description, 'reviewing alpha');
  assert.equal(outputs.go, 'true');
});

test('cert-review.yml: plan runs for forks and cancelled runs, may post statuses, and an unfinished review fails its pending head', () => {
  const y = workflow('cert-review.yml');
  const plan = y.slice(y.indexOf('  plan:\n'), y.indexOf('  review:\n'));
  assert.match(plan, /if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.event == 'pull_request'\n/);
  assert.doesNotMatch(plan, /head_repository\.full_name == github\.repository|conclusion != 'cancelled'/);
  assert.match(plan, /statuses: write/);
  assert.match(plan, /sparse-checkout: scripts\/cert-review/);
  const unfinished = y.slice(y.indexOf('  unfinished:\n'));
  assert.match(unfinished, /needs: \[plan, review, record\]/);
  assert.match(unfinished, /if: always\(\) && needs\.plan\.outputs\.go == 'true' && needs\.record\.result != 'success'/);
  assert.match(unfinished, /failIfOurs/);
  assert.match(unfinished, /sparse-checkout: scripts\/cert-review/);
});

test('ladder-pr.yml: the group job may post statuses, and posts only on a real merge group', () => {
  const y = workflow('ladder-pr.yml');
  const group = y.slice(y.indexOf('  group:\n'), y.indexOf('  kernel-compat:\n'));
  assert.match(group, /statuses: write/);
  assert.doesNotMatch(group, /contents: write|pull-requests: write|actions: write/);
  assert.match(group, /POST_STATUS: \$\{\{ github\.event_name == 'merge_group' && '--post-status' \|\| '' \}\}/);
  assert.match(group, /if: failure\(\) && github\.event_name == 'merge_group' && steps\.g\.outputs\.posted != 'true'/);
});

test('groupStatus: success names each queued PR at its head; a problem or error is failure', () => {
  const ok = groupStatus({ problems: [], members: [{ number: 11, head: H }, { number: 12, head: OLD }] });
  assert.deepEqual(ok, { state: 'success', description: 'queued PRs certified: #11@aaaaaaa, #12@bbbbbbb', go: false });
  const bad = groupStatus({ problems: ['#12: the cert-review status on its head is pending'], members: [] });
  assert.equal(bad.state, 'failure');
  assert.match(bad.description, /^merge group refused: #12/);
  assert.equal(groupStatus({ error: 'x'.repeat(500) }).description.length, LIMIT);
});

test('reportStatus: a dry run sends nothing; a merge group posts cert-review on the group head', async () => {
  const sent = [];
  const send = async (path, opts) => sent.push({ path, opts });
  const decision = groupStatus({ problems: [], members: [{ number: 11, head: H }] });
  assert.match(await reportStatus({ head: OLD, post: false, decision }, send), /^dry run, would post cert-review=success on b{40}: queued PRs certified: #11@aaaaaaa$/);
  assert.deepEqual(sent, []);
  assert.match(await reportStatus({ head: OLD, post: true, decision, runUrl: 'https://x/runs/1' }, send), /^posted cert-review=success/);
  assert.deepEqual(sent, [{ path: `/statuses/${OLD}`, opts: { method: 'POST', body: { state: 'success', context: 'cert-review', description: decision.description, target_url: 'https://x/runs/1' } } }]);
});

test('merge-group-check.mjs: a group that fails closed reports a failure status, and without --post-status only says what it would post', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/merge-group-check.mjs'), '--base', head, '--head', head], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /failed closed: .*adds no commit/);
  assert.match(r.stdout, new RegExp(`dry run, would post cert-review=failure on ${head}: merge group check failed: `));
});

const RUN = 'https://github.com/ai-ecoverse/homescoop/actions/runs/123';

function statusApi(targetUrl) {
  const posted = [];
  const github = {
    rest: {
      repos: {
        getCombinedStatusForRef: async () => ({ data: { statuses: targetUrl === undefined ? [{ context: 'ci', target_url: RUN }] : [{ context: 'other', target_url: 'x' }, { context: CONTEXT, target_url: targetUrl }] } }),
        createCommitStatus: async (s) => posted.push(s),
      },
    },
  };
  return { github, posted };
}

test('ownedBy: this run\'s plan and record URLs, never another run whose id shares its leading digits', () => {
  assert.equal(ownedBy(RUN, RUN), true);
  assert.equal(ownedBy(`${RUN}/artifacts/9`, RUN), true);
  assert.equal(ownedBy(`${RUN}4`, RUN), false);
  assert.equal(ownedBy(`${RUN}4/artifacts/9`, RUN), false);
  assert.equal(ownedBy('', RUN), false);
  assert.equal(ownedBy(undefined, RUN), false);
  assert.equal(ownedBy(RUN, ''), false);
});

test('failIfOurs: fails a head whose cert-review status is this run\'s, and leaves any other alone', async () => {
  const rows = [
    [RUN, true],
    [`${RUN}/artifacts/77`, true],
    [`${RUN}4`, false],
    ['https://github.com/ai-ecoverse/homescoop/actions/runs/999/artifacts/1', false],
    [undefined, false],
  ];
  for (const [target, posts] of rows) {
    const { github, posted } = statusApi(target);
    const r = await failIfOurs({ github, owner: 'ai-ecoverse', repo: 'homescoop', sha: H, runUrl: RUN, description: 'not certified: x' });
    assert.equal(r.posted, posts, String(target));
    assert.equal(posted.length, posts ? 1 : 0, String(target));
    if (posts) assert.deepEqual(posted[0], { owner: 'ai-ecoverse', repo: 'homescoop', sha: H, state: 'failure', context: CONTEXT, description: 'not certified: x', target_url: RUN });
  }
  const { github, posted } = statusApi(RUN);
  assert.equal((await failIfOurs({ github, owner: 'o', repo: 'r', sha: '', runUrl: RUN, description: 'x' })).posted, false);
  assert.deepEqual(posted, []);
});

async function runStep(file, marker, env, target) {
  const { github, posted } = statusApi(target);
  const fn = new AsyncFunction('github', 'context', 'core', 'process', stepScript(file, marker));
  await fn(github, { repo: { owner: 'ai-ecoverse', repo: 'homescoop' } }, { info() {}, notice() {} }, { env: { GITHUB_WORKSPACE: ROOT, RUN_URL: RUN, ...env } });
  return posted;
}

test('the unfinished job and the plan\'s fallback step fail only a head this run left pending', async () => {
  const steps = [
    ['- name: A failure status, so no head is left pending', { HEAD: H, DESCRIPTION: 'not certified: cert-review did not finish (review failure, record skipped)' }, /did not finish \(review failure/],
    ['- name: A failure status when the plan stopped after its pending one', { HEAD: H }, /the cert-review plan did not finish/],
  ];
  for (const [marker, env, description] of steps) {
    const own = await runStep('cert-review.yml', marker, env, RUN);
    assert.equal(own.length, 1, marker);
    assert.equal(own[0].state, 'failure');
    assert.equal(own[0].sha, H);
    assert.match(own[0].description, description);
    assert.deepEqual(await runStep('cert-review.yml', marker, env, `${RUN}4`), [], marker);
    assert.deepEqual(await runStep('cert-review.yml', marker, env, undefined), [], marker);
  }
  const y = workflow('cert-review.yml');
  assert.match(y, /if: \(failure\(\) \|\| cancelled\(\)\) && steps\.plan\.outputs\.pending_on != ''/);
  assert.equal(planScript().match(/core\.setOutput\('pending_on', facts\.sha\)/g).length, 2);
});
