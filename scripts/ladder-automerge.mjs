#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export function mergeProblems({ repo, pr, review, ladder, files, majors }) {
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
  const paths = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  const human = [...new Set(paths.filter((p) => HUMAN_ONLY.some((re) => re.test(p))))];
  if (human.length) problems.push(`it touches ${human.slice(0, 5).join(', ')}${human.length > 5 ? ', …' : ''}, which stay human`);
  if (!paths.some((p) => PUBLISHABLE.test(p))) problems.push('it touches no publishable package file');
  if (pr.mergeable_state !== 'clean') problems.push(`mergeable_state is ${pr.mergeable_state}`);
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
  return { pr, review, problems: mergeProblems({ repo, pr, review, ladder, files, majors }) };
}

export async function merge({ repo, number, head }, io) {
  const { pr, problems } = await decide({ repo, number }, io);
  if (problems[0] === 'already merged') return { merged: false, reason: 'already merged' };
  if (pr.head.sha !== head) throw new Error(`PR #${number} moved from ${head} to ${pr.head.sha}`);
  if (problems.length) throw new Error(`PR #${number} no longer qualifies right before the merge: ${problems.join('; ')}`);
  let sha;
  try {
    ({ sha } = await io.mergePull(number, head));
  } catch (err) {
    if ((await io.pull(number)).merged) return { merged: false, reason: 'already merged' };
    throw err;
  }
  const commit = await io.commit(sha);
  return { merged: true, sha, before: commit.parents[0].sha };
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
  throw new Error('usage: ladder-automerge.mjs decide (--pr <n> | --cert-review-run <id>) | merge --pr <n> --head <sha> [--run-url <url>] | report --pr <n> --reason <text>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::ladder-automerge: ${err.message}`);
    process.exit(1);
  });
}
