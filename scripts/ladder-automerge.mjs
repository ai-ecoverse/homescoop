#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { certReview, githubApi, githubIo } from './ladder-merge-resolve.mjs';
import { reportFromEnv } from './publish-failure-issue.mjs';
import { npmify } from './upstream-version-text.mjs';

export const HUMAN_ONLY = [/^\.github\/workflows\//, /^scripts\//, /^shims\//, /^crates\//, /^renovate\.json$/, /^package\.json$/];
export const PUBLISHABLE = /^packages\/([^/]+)\/(?:recipe\.yaml$|package(?:\/|$))/;
export const MARKER = '<!-- ladder-automerge -->';

export function recipeVersion(yaml) {
  return String(yaml ?? '').match(/^version:\s*["']?([^"'\s#]+)/m)?.[1];
}

export function isMajorBump(from, to) {
  if (from === undefined) return false;
  const major = (v) => String(npmify(String(v ?? ''))).match(/^(\d+)\./)?.[1];
  const [a, b] = [major(from), major(to)];
  return a === undefined || b === undefined || Number(b) > Number(a);
}

export function mergeProblems({ repo, pr, review, ladder, files, majors, queue = false }) {
  if (pr.merged) return ['already merged'];
  const problems = [];
  if (pr.state !== 'open') problems.push(`PR #${pr.number} is ${pr.state}`);
  if (pr.draft) problems.push(`PR #${pr.number} is a draft`);
  if (pr.head.repo?.full_name !== repo) problems.push(`PR #${pr.number} comes from a fork (${pr.head.repo?.full_name ?? 'deleted repository'})`);
  if (pr.base.ref !== 'main') problems.push(`PR #${pr.number} targets ${pr.base.ref}, not main (stacked)`);
  if ((pr.labels ?? []).some((l) => l.name === 'homescoop-major')) problems.push(`PR #${pr.number} is labelled homescoop-major`);
  for (const m of majors) problems.push(`${m.pkg} recipe.yaml goes ${m.from} → ${m.to}, a semver major`);
  if (review.state !== 'success') {
    const why = review.problem ? `: ${review.problem}` : '';
    problems.push(`the cert-review on ${pr.head.sha} is ${review.state}${why}`);
  }
  if (!ladder) problems.push(`no ladder-pr run at ${pr.head.sha}`);
  else {
    if (ladder.run.status !== 'completed' || ladder.run.conclusion !== 'success') {
      problems.push(`ladder-pr run ${ladder.run.id} at the head concluded ${ladder.run.conclusion || ladder.run.status}`);
    }
    const ci = ladder.jobs.find((j) => j.name === 'ci');
    if (ci?.conclusion !== 'success') problems.push(`ladder-pr's ci on the head is ${ci ? ci.conclusion || ci.status : 'missing'}`);
  }
  if (files.length < (pr.changed_files ?? 0)) problems.push(`the file list stops at ${files.length} of ${pr.changed_files} files`);
  const paths = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  const human = [...new Set(paths.filter((p) => HUMAN_ONLY.some((re) => re.test(p))))];
  if (human.length) problems.push(`it touches ${human.slice(0, 5).join(', ')}${human.length > 5 ? ', …' : ''}, which stay human`);
  if (!paths.some((p) => PUBLISHABLE.test(p))) problems.push('it touches no publishable package file');
  const ready = pr.mergeable_state === 'clean' || (queue && pr.mergeable_state === 'blocked' && pr.mergeable === true);
  if (!ready) problems.push(`mergeable_state is ${pr.mergeable_state}${queue ? ' (merge queue)' : ''}`);
  return problems;
}

export async function settledPull(number, io, tries = 6) {
  let pr = await io.pull(number);
  for (let i = 1; i < tries && pr.state === 'open' && (pr.mergeable === null || pr.mergeable_state === 'unknown'); i++) {
    await io.sleep(5000);
    pr = await io.pull(number);
  }
  return pr;
}

export async function majorBumps(pr, files, io) {
  const pkgs = [...new Set(files.map((f) => f.filename.match(PUBLISHABLE)?.[1]).filter(Boolean))];
  const out = [];
  for (const pkg of pkgs) {
    const path = `packages/${pkg}/recipe.yaml`;
    const [from, to] = [recipeVersion(await io.file(path, pr.base.sha)), recipeVersion(await io.file(path, pr.head.sha))];
    if (to !== undefined && isMajorBump(from, to)) out.push({ pkg, from, to });
  }
  return out;
}

export async function decide({ repo, number, asIfOpen }, io) {
  const settled = await settledPull(number, io);
  const pr = asIfOpen ? { ...settled, merged: false, state: 'open' } : settled;
  if (pr.merged) return { pr, problems: ['already merged'], review: { state: 'n/a' } };
  const files = await io.files(number);
  const review = await certReview({ number: pr.number, head: pr.head.sha }, io);
  const ladder = await io.ladderRun(pr.head.sha);
  const majors = await majorBumps(pr, files, io);
  const queue = await io.mergeQueue(pr.base.ref);
  return { pr, review, queue, problems: mergeProblems({ repo, pr, review, ladder, files, majors, queue }) };
}

async function mergedHere(pr, head, io) {
  if (pr.merged_by?.login !== 'github-actions[bot]' || !pr.merge_commit_sha) return { merged: false, reason: 'already merged' };
  const commit = await io.commit(pr.merge_commit_sha);
  if (commit.parents?.[1]?.sha !== head) return { merged: false, reason: `already merged, but not at ${head}` };
  return { merged: true, sha: pr.merge_commit_sha, before: commit.parents[0].sha };
}

export async function merge({ repo, number, head }, io) {
  const { pr, problems, queue: queued } = await decide({ repo, number }, io);
  if (problems[0] === 'already merged') return mergedHere(pr, head, io);
  if (pr.head.sha !== head) throw new Error(`PR #${number} moved from ${head} to ${pr.head.sha}`);
  if (problems.length) throw new Error(`PR #${number} no longer qualifies right before the merge: ${problems.join('; ')}`);
  if (queued) {
    const how = await queue(pr, head, io);
    return { merged: false, queued: true, reason: `${how} at ${head}; the queue's push to ${pr.base.ref} starts ladder-merge` };
  }
  let sha;
  try {
    ({ sha } = await io.mergePull(number, head));
  } catch (err) {
    const after = await io.pull(number);
    if (after.merged) return mergedHere(after, head, io);
    throw err;
  }
  const commit = await io.commit(sha);
  return { merged: true, sha, before: commit.parents[0].sha };
}

export const MERGE_QUEUE = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) { mergeQueue(branch: $branch) { id } }
}`;

export const AUTO_MERGE = `mutation($id: ID!, $head: GitObjectID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE, expectedHeadOid: $head }) {
    pullRequest { number autoMergeRequest { enabledAt } }
  }
}`;

export const ENQUEUE = `mutation($id: ID!, $head: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head }) { mergeQueueEntry { position } }
}`;

export async function queue(pr, head, io) {
  try {
    await io.gql(AUTO_MERGE, { id: pr.node_id, head });
    return 'auto-merge (merge commit) enabled, the queue takes it';
  } catch (err) {
    if (!/clean status/i.test(err.message)) throw err;
    await io.gql(ENQUEUE, { id: pr.node_id, head });
    return 'enqueued';
  }
}

export const CLOSING_ISSUES = `query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      closingIssuesReferences(first: 100) { nodes { number state repository { nameWithOwner } } }
    }
  }
}`;

export async function closeLinkedIssues({ repo, number, sha }, io) {
  const [owner, name] = repo.split('/');
  const done = { closed: [], skipped: [], warnings: [] };
  let nodes;
  try {
    const data = await io.graphql(CLOSING_ISSUES, { owner, name, pr: number });
    nodes = data?.repository?.pullRequest?.closingIssuesReferences?.nodes;
    if (!Array.isArray(nodes)) throw new Error('no closingIssuesReferences in the answer');
  } catch (err) {
    done.warnings.push(`cannot read the issues PR #${number} closes: ${err.message}`);
    return done;
  }
  for (const issue of nodes) {
    const where = issue?.repository?.nameWithOwner ?? '';
    const ref = `${where}#${issue?.number}`;
    if (where.toLowerCase() !== repo.toLowerCase()) done.skipped.push(`${ref}: another repo`);
    else if (issue.state !== 'OPEN') done.skipped.push(`${ref}: ${String(issue.state).toLowerCase()}`);
    else {
      try {
        await io.gh(['issue', 'close', String(issue.number), '--repo', repo, '--comment', `Closed by #${number} (merge ${sha}), merged by ladder-automerge.`]);
        done.closed.push(issue.number);
      } catch (err) {
        done.warnings.push(`cannot close #${issue.number}: ${err.message}`);
      }
    }
  }
  return done;
}

export function commentBody(reason) {
  return `${MARKER}\nauto-merge skipped: ${reason}\n`;
}

export async function reportSkip(number, reason, io) {
  const mine = (await io.comments(number)).find((c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(MARKER));
  if (mine) await io.editComment(mine.id, commentBody(reason));
  else await io.addComment(number, commentBody(reason));
  return mine ? 'updated' : 'added';
}

function liveIo({ repo, token }) {
  const api = githubApi({ repo, token });
  const json = async (path, init) => (await api(path, init)).json();
  const pages = async (path) => {
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  };
  const gh = (args) => promisify(execFile)('gh', args, { env: { ...process.env, GH_TOKEN: token ?? '' } });
  return {
    ...githubIo({ repo, token }),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    pull: (n) => json(`/pulls/${n}`),
    files: (n) => pages(`/pulls/${n}/files`),
    async file(path, ref) {
      try {
        const got = await json(`/contents/${path}?ref=${ref}`);
        return Buffer.from(got.content ?? '', 'base64').toString('utf8');
      } catch (err) {
        if (err.status === 404) return undefined;
        throw err;
      }
    },
    async ladderRun(head) {
      const q = new URLSearchParams({ head_sha: head, event: 'pull_request', per_page: '20' });
      const runs = (await json(`/actions/workflows/ladder-pr.yml/runs?${q}`)).workflow_runs ?? [];
      const run = runs.find((r) => r.head_sha === head);
      if (!run) return null;
      return { run, jobs: (await json(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs ?? [] };
    },
    async reviewRunPr(id) {
      const artifacts = (await json(`/actions/runs/${id}/artifacts?per_page=100`)).artifacts ?? [];
      return artifacts.map((a) => a.name.match(/^cert-review-record-(\d+)$/)?.[1]).find(Boolean);
    },
    mergePull: (n, sha) => json(`/pulls/${n}/merge`, { method: 'PUT', body: { merge_method: 'merge', sha } }),
    commit: (sha) => json(`/commits/${sha}`),
    comments: (n) => pages(`/issues/${n}/comments`),
    addComment: (n, body) => json(`/issues/${n}/comments`, { method: 'POST', body: { body } }),
    editComment: (id, body) => json(`/issues/comments/${id}`, { method: 'PATCH', body: { body } }),
    async gql(query, vars) {
      const args = ['api', 'graphql', '-f', `query=${query}`];
      for (const [k, v] of Object.entries(vars)) args.push('-f', `${k}=${v}`);
      const got = JSON.parse((await gh(args)).stdout);
      if (got.errors?.length) throw new Error(got.errors.map((e) => e.message).join('; '));
      return got.data;
    },
    async mergeQueue(branch) {
      const [owner, name] = repo.split('/');
      const got = await this.gql(MERGE_QUEUE, { owner, name, branch });
      return Boolean(got.repository?.mergeQueue?.id);
    },
    async graphql(query, { owner, name, pr }) {
      const { stdout } = await gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`]);
      const got = JSON.parse(stdout);
      if (got.errors?.length) throw new Error(got.errors.map((e) => e.message).join('; '));
      return got.data;
    },
    gh,
  };
}

function output(values) {
  for (const [k, v] of Object.entries(values)) {
    console.log(`${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function main([mode, ...argv]) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const repo = process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop';
  const io = liveIo({ repo, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  if (mode === 'decide') {
    const number = at('--pr') || (at('--cert-review-run') && (await io.reviewRunPr(at('--cert-review-run'))));
    if (!number) {
      console.log('no cert-review record names a PR; nothing to merge');
      return output({ merge: 'false' });
    }
    const { pr, review, problems } = await decide({ repo, number: Number(number), asIfOpen: argv.includes('--as-if-open') }, io);
    const values = { pr: pr.number, head: pr.head.sha, base: pr.base.sha, merge: String(problems.length === 0), report: '' };
    if (problems.length === 0) {
      console.log(`PR #${pr.number} at ${pr.head.sha}: merge (cert-review run ${review.runId}, ladder-pr ci green, mergeable clean)`);
    } else if (problems[0] !== 'already merged') {
      const reason = problems.join('; ');
      console.log(`PR #${pr.number} at ${pr.head.sha}: auto-merge skipped: ${reason}`);
      summary(`PR #${pr.number}: auto-merge skipped: ${reason}`);
      if (review.state === 'success') values.report = reason;
    } else console.log(`PR #${pr.number}: already merged`);
    return output(values);
  }
  if (mode === 'report') {
    const how = await reportSkip(Number(at('--pr')), at('--reason'), io);
    return console.log(`${how} the auto-merge comment on #${at('--pr')}`);
  }
  if (mode === 'merge') {
    const number = Number(at('--pr'));
    try {
      const done = await merge({ repo, number, head: at('--head') }, io);
      if (done.queued) {
        console.log(`PR #${number}: ${done.reason}`);
        summary(`PR #${number}: ${done.reason}`);
        return output({ sha: '', before: '' });
      }
      if (!done.merged) {
        console.log(`PR #${number}: ${done.reason}; nothing to publish here`);
        return output({ sha: '', before: '' });
      }
      console.log(`merged PR #${number} as ${done.sha} (first parent ${done.before})`);
      return output({ sha: done.sha, before: done.before });
    } catch (err) {
      console.log(`::error::auto-merge of PR #${number} failed: ${err.message}`);
      const body = `ladder-automerge could not merge PR #${number} at ${at('--head')}: ${err.message}\n\nrun: ${at('--run-url') ?? '(not given)'}`;
      await reportFromEnv({ title: `publish-failure: auto-merge of #${number}`, body });
      process.exit(1);
    }
  }
  if (mode === 'close-issues') {
    const number = Number(at('--pr'));
    const done = await closeLinkedIssues({ repo, number, sha: at('--sha') }, io);
    for (const n of done.closed) console.log(`closed #${n} (linked from PR #${number})`);
    for (const why of done.skipped) console.log(`left ${why}`);
    for (const why of done.warnings) console.log(`::warning::ladder-automerge: ${why}`);
    return;
  }
  throw new Error('usage: ladder-automerge.mjs decide (--pr <n> | --cert-review-run <id>) | merge --pr <n> --head <sha> [--run-url <url>] | report --pr <n> --reason <text> | close-issues --pr <n> --sha <merge sha>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::ladder-automerge: ${err.message}`);
    process.exit(1);
  });
}
