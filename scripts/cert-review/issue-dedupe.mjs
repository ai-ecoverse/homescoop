#!/usr/bin/env node
// cert-review's after-run check (gate `issue-dedupe`): every `[cert]` issue this run opened carries a
// cert-review-key marker, so it came through file-issue.mjs and its dedupe. It lists the issues the
// workflow's bot opened since the review started (`--since`) that are `[cert]` issues or name this run
// (`--run`), and prints `issue-dedupe: PASS …` when each has a marker, `issue-dedupe: FAIL …` (exit 1)
// naming the ones that don't. It never touches the verdict: the record job certifies or not as before.
//   node issue-dedupe.mjs --since <ISO time> --run <run url> [--repo owner/repo] [--author github-actions[bot]]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyIn } from './file-issue.mjs';

export const BOT = 'github-actions[bot]';

export function ours(issue, { since, run, author = BOT }) {
  if (issue.pull_request) return false;
  if (issue.user?.login !== author) return false;
  if (Date.parse(issue.created_at) < Date.parse(since)) return false;
  return /^\[cert\]/i.test(String(issue.title ?? '').trim()) || (Boolean(run) && String(issue.body ?? '').includes(run));
}

export function check(issues, opts) {
  const mine = issues.filter((i) => ours(i, opts)).sort((a, b) => a.number - b.number);
  const bad = mine.filter((i) => !keyIn(i.body));
  if (bad.length) {
    return {
      ok: false,
      line: `issue-dedupe: FAIL ${bad.map((i) => `#${i.number}`).join(', ')} ${bad.length === 1 ? 'has' : 'have'} no cert-review-key marker: opened outside scripts/cert-review/file-issue.mjs, so not deduped (${mine.length} issue(s) opened by this run)`,
      mine,
      bad,
    };
  }
  return { ok: true, line: `issue-dedupe: PASS ${mine.length} issue(s) opened by this run, each with a cert-review-key marker${mine.length ? `: ${mine.map((i) => `#${i.number}`).join(', ')}` : ''}`, mine, bad };
}

export async function issuesSince({ repo, token, since, fetchImpl = fetch }) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GET ${repo}/issues returned ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export async function main(argv, { env = process.env, list, out = console.log } = {}) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const since = at('--since');
  const run = at('--run') || env.RUN_URL;
  const repo = at('--repo') || env.GH_REPO || env.GITHUB_REPOSITORY;
  if (!since || Number.isNaN(Date.parse(since)) || !repo) {
    out('issue-dedupe: FAIL usage: issue-dedupe.mjs --since <ISO time> --run <run url> [--repo owner/repo]');
    return 1;
  }
  let issues;
  try {
    issues = list ? await list({ repo, since }) : await issuesSince({ repo, token: env.GH_TOKEN || env.GITHUB_TOKEN, since });
  } catch (e) {
    out(`issue-dedupe: FAIL could not list the issues opened since ${since}: ${e.message}`);
    return 1;
  }
  const r = check(issues, { since, run, author: at('--author') || BOT });
  for (const i of r.mine) out(`  #${i.number} ${keyIn(i.body) ? `key ${keyIn(i.body)}` : 'NO MARKER'}  ${i.title}`);
  out(r.ok ? r.line : `::error::${r.line}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
