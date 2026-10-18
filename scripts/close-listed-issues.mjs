#!/usr/bin/env node
// After a merge to main: close the issues a merged pull request's body names after a closing keyword
// that GitHub didn't link. GitHub links only the first number after a keyword, so `Fixes #1, #2, #3`
// closes #1 and leaves #2 and #3 open (#1117 left five issues open that way). Merge-queue merges do
// close linked issues (#1105 closed #1031 and #1072); it's only the comma lists that GitHub ignores.
// Each issue it closes gets a comment naming the pull request and the merge commit. A closing keyword
// in a quote, inline code, a fenced block or an HTML comment doesn't count, and neither does "Refs",
// "Part of" or "#N" on its own. Issues GitHub did link (closingIssuesReferences) are left to GitHub,
// and a commit counts only if it is the pull request's own merge commit (merge_commit_sha), so a
// branch commit can't borrow another PR's message. An issue lookup that fails other than 404/410
// fails the run. Prints `close-listed-issues: PASS …` (or FAIL, with exit 1) for scripts/gate.mjs.
//   node scripts/close-listed-issues.mjs (--before <sha> --after <sha> | --commits <sha,sha…>) [--repo owner/repo] [--dry-run]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEYWORD = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?`;
const REF = String.raw`(?:(?:ai-ecoverse\/homescoop)?#\d+)`;
const SEP = String.raw`\s*(?:,\s*(?:and\b|&)?|and\b|&)\s*`;
const LIST = new RegExp(String.raw`${KEYWORD}\s+(${REF}(?:${SEP}${REF})*)`, 'gi');

/** Strip fenced blocks, inline code and quoted lines, which can't close anything. */
export function prose(body) {
  return String(body ?? '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

/** The issue numbers a body names after a closing keyword, including every number of a list. */
export function listedIssues(body) {
  const out = new Set();
  for (const m of prose(body).matchAll(LIST)) for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  return [...out].sort((a, b) => a - b);
}

/** The pull request a merge-queue (or merge-button) merge commit merged, from its message. */
export function mergedPr(message) {
  const m = /^Merge pull request #(\d+) from /.exec(String(message ?? ''));
  return m ? Number(m[1]) : null;
}

function api(repo, token, fetchImpl) {
  return async (path, { method = 'GET', body } = {}) => {
    const url = path === '/graphql' || path.startsWith('/repos') ? path : `/repos/${repo}${path}`;
    const res = await fetchImpl(`https://api.github.com${url}`, {
      method,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} returned ${res.status}`), { status: res.status });
    const data = res.status === 204 ? null : await res.json();
    if (path === '/graphql' && data?.errors?.length) throw new Error(`graphql: ${data.errors.map((e) => e.message).join('; ')}`);
    return data;
  };
}

/** The issues GitHub itself linked to the pull request; it closes those, so this leaves them alone. */
export async function linkedIssues(call, repo, pr) {
  const [owner, name] = repo.split('/');
  const data = await call('/graphql', {
    method: 'POST',
    body: { query: 'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){closingIssuesReferences(first:100){nodes{number}}}}}', variables: { o: owner, n: name, p: pr } },
  });
  return new Set((data?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? []).map((i) => i.number));
}

/** The commits a push brought, oldest first (GET /compare, so a large push or a rewind is handled). */
export async function pushedCommits(call, before, after) {
  if (!after || /^0+$/.test(after)) return [];
  if (!before || /^0+$/.test(before)) return [after];
  const shas = [];
  for (let page = 1; ; page++) {
    const cmp = await call(`/compare/${before}...${after}?per_page=100&page=${page}`);
    if (cmp.status === 'behind' || cmp.status === 'identical') return shas;
    const batch = (cmp.commits ?? []).map((c) => c.sha);
    shas.push(...batch);
    if (batch.length < 100) return shas;
  }
}

export async function run({ repo, commits, dryRun = false, call, out = console.log }) {
  const closed = [];
  const skipped = [];
  for (const sha of commits) {
    const commit = await call(`/commits/${sha}`);
    const pr = mergedPr(commit.commit?.message);
    if (!pr) continue;
    const pull = await call(`/pulls/${pr}`);
    // Only the pull request's own merge commit counts: a branch commit can say "Merge pull request #N" too.
    if (!pull.merged_at || pull.merge_commit_sha !== commit.sha || pull.base?.ref !== 'main') {
      if (pull.merge_commit_sha !== commit.sha) skipped.push(`${sha.slice(0, 8)} (not #${pr}'s merge commit)`);
      continue;
    }
    const linked = await linkedIssues(call, repo, pr);
    for (const n of listedIssues(pull.body)) {
      if (n === pr || linked.has(n)) continue;
      let issue;
      try {
        issue = await call(`/issues/${n}`);
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
        skipped.push(`#${n} (${e.message})`);
        continue;
      }
      if (issue.pull_request) { skipped.push(`#${n} (a pull request)`); continue; }
      if (issue.state !== 'open') continue;
      out(`  #${n}: named by #${pr} (${sha.slice(0, 8)}) after a closing keyword, still open${dryRun ? ' (dry run)' : ''}`);
      if (!dryRun) {
        await call(`/issues/${n}/comments`, { method: 'POST', body: { body: `Closed by #${pr} (merged as ${sha.slice(0, 8)}). Its body names this issue after a closing keyword, in a list (\`Fixes #a, #b\`), and GitHub only links the first number of such a list. Reopen it if #${pr} didn't fix it all.` } });
        await call(`/issues/${n}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
      }
      closed.push(n);
    }
  }
  out(`close-listed-issues: PASS ${closed.length ? `${dryRun ? 'would close' : 'closed'} ${closed.map((n) => `#${n}`).join(', ')}` : 'nothing left open'}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`);
  return { closed, skipped };
}

async function main(argv, env = process.env) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const repo = at('--repo') || env.GITHUB_REPOSITORY;
  const sha = (s) => /^[0-9a-f]{7,40}$/.test(s ?? '');
  const listed = String(at('--commits') ?? '').split(/[\s,]+/).filter(sha);
  const push = argv.includes('--after');
  if (!repo || (push ? !sha(at('--after')) : !listed.length)) {
    console.log('close-listed-issues: FAIL usage: close-listed-issues.mjs (--before <sha> --after <sha> | --commits <sha,sha…>) [--repo owner/repo] [--dry-run]');
    return 1;
  }
  try {
    const call = api(repo, env.GH_TOKEN || env.GITHUB_TOKEN, fetch);
    const commits = push ? await pushedCommits(call, at('--before'), at('--after')) : listed;
    if (!commits.length) {
      console.log('close-listed-issues: PASS nothing to check (the push brought no commits)');
      return 0;
    }
    await run({ repo, commits, dryRun: argv.includes('--dry-run'), call });
    return 0;
  } catch (e) {
    console.log(`close-listed-issues: FAIL ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main(process.argv.slice(2));
