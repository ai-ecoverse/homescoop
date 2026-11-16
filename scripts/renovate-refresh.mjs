#!/usr/bin/env node
/**
 * Push the mechanical refresh to Renovate recipe PRs, so they don't wait for
 * an agent (docs/renovate.md, "The refresh").
 *
 *   node scripts/renovate-refresh.mjs [--repo <owner/name>] [--pr <n>]… [--dry-run]
 *                                     [--max <prs>] [--budget <seconds>]
 *
 * CI never pushes to a pull request (a GITHUB_TOKEN push starts no runs), so
 * the recipe-sha job only prints `recipe-sha: FAIL <pkg>: needs refresh: …`.
 * This script runs that command for each open Renovate PR whose recipe-sha
 * check failed on a head Renovate wrote, and pushes the result as whoever runs
 * it (git's own credentials), so the PR's runs start normally.
 *
 * Per PR, in a temporary worktree of the repo this script lives in:
 *  1. rebase the head onto origin/main, so the branch's own scripts (which
 *     the recipe-sha job runs) are main's;
 *  2. refresh-recipe-sha.mjs <pkg> (RECIPE_SHA_BASE=origin/main), then
 *     sync-package-version.mjs <pkg> --write for each touched recipe, then
 *     readme-table.mjs --write;
 *  3. commit only packages/<pkg>/{recipe.yaml,package/package.json,
 *     package/README.md} and README.md, as renovate-refresh@homescoop.invalid
 *     (renovate.json's gitIgnoredAuthors, so Renovate keeps rebasing);
 *  4. push with --force-with-lease against the head it read.
 *
 * Anything that isn't mechanical (a drafted or hand-edited PR, a head someone
 * else wrote, a rebase conflict, a refresh that fails, such as a patch that no
 * longer applies or bytes that moved under an unchanged URL, or a change
 * outside those files) is left alone. A refresh that fails gets one comment
 * per head (marker <!-- homescoop:renovate-refresh -->), naming the reason, for
 * a person or the coordinator. Prints nothing when there is nothing to do.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- homescoop:renovate-refresh -->';
export const AUTHOR = { name: 'homescoop renovate-refresh', email: 'renovate-refresh@homescoop.invalid' };
const RENOVATE_LOGIN = /^(app\/)?renovate(\[bot\])?$/;
const RENOVATE_EMAIL = /^29139614\+renovate\[bot\]@users\.noreply\.github\.com$/;
const RECIPE = /^packages\/([^/]+)\/recipe\.ya?ml$/;

/** The recipes a PR touches, or null when it touches anything but recipe.yaml files. */
export function packagesOf(files) {
  const pkgs = new Set();
  for (const f of files) {
    const m = RECIPE.exec(typeof f === 'string' ? f : f.path);
    if (!m) return null;
    pkgs.add(m[1]);
  }
  return pkgs.size ? [...pkgs].sort() : null;
}

/** The paths a refresh of these packages may write. */
export function allowedPaths(pkgs) {
  const out = new Set(['README.md']);
  for (const p of pkgs) {
    out.add(`packages/${p}/recipe.yaml`);
    out.add(`packages/${p}/package/package.json`);
    out.add(`packages/${p}/package/README.md`);
  }
  return out;
}

export const strayPaths = (changed, pkgs) => {
  const ok = allowedPaths(pkgs);
  return changed.filter((p) => !ok.has(p));
};

/** The recipe-sha check's conclusion on the PR head (statusCheckRollup), or null. */
export function recipeSha(rollup) {
  const runs = (rollup || []).filter((c) => c && c.name === 'recipe-sha');
  if (!runs.length) return null;
  const last = runs[runs.length - 1];
  return last.status && last.status !== 'COMPLETED' ? 'PENDING' : last.conclusion || null;
}

/** Whether a commit (gh's commits[] entry) is Renovate's own. */
export const byRenovate = (c) =>
  (c?.authors || []).length > 0 && c.authors.every((a) => RENOVATE_EMAIL.test(a.email || '') || RENOVATE_LOGIN.test(a.login || ''));

/**
 * Why a PR is not ours to refresh, or null when it is. `pr` is gh's JSON:
 * number, headRefName, headRefOid, isDraft, isCrossRepository, author, files,
 * commits, statusCheckRollup, comments.
 */
export function skipReason(pr) {
  if (!RENOVATE_LOGIN.test(pr.author?.login || '')) return 'not a Renovate PR';
  if (pr.isDraft) return 'draft (held by hand)';
  if (pr.isCrossRepository) return 'head in a fork';
  if (!String(pr.headRefName || '').startsWith('renovate/')) return 'not a renovate/ branch';
  if (!packagesOf(pr.files || [])) return 'touches more than recipe.yaml files (hand work)';
  const commits = pr.commits || [];
  if (!commits.length || !commits.every(byRenovate)) return 'a commit not by Renovate (refreshed or hand-edited)';
  const sha = recipeSha(pr.statusCheckRollup);
  if (sha !== 'FAILURE') return `recipe-sha is ${sha ?? 'missing'}`;
  if (reportedFor(pr.comments, pr.headRefOid)) return 'already reported as needing a hand for this head';
  return null;
}

/** Whether a needs-hand comment already names this head. */
export function reportedFor(comments, head) {
  return (comments || []).some((c) => String(c.body || '').includes(MARKER) && String(c.body).includes(`head ${head}`));
}

export function handComment(head, reason, log) {
  const tail = String(log || '').trim().split('\n').slice(-25).join('\n');
  return [
    MARKER,
    `**renovate-refresh: needs a hand** on head ${head}`,
    '',
    `The mechanical refresh (\`scripts/renovate-refresh.mjs\`) stopped: ${reason}. Nothing was pushed. Fix the branch by hand; the refresh tries again once Renovate writes a new head.`,
    ...(tail ? ['', '```text', tail, '```'] : []),
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const o = { repo: 'ai-ecoverse/homescoop', prs: [], dryRun: false, max: 5, budget: 480 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--pr') o.prs.push(Number(argv[++i]));
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--max') o.max = Number(argv[++i]);
    else if (a === '--budget') o.budget = Number(argv[++i]);
    else throw new Error(`renovate-refresh: unknown argument ${a}`);
  }
  return o;
}

// pr list can't carry commits for 100 PRs (GraphQL's node limit), so the list
// is light and each PR still in the running is read in full.
const LIGHT = 'number,headRefName,headRefOid,isDraft,isCrossRepository,author,files,statusCheckRollup';
const FIELDS = `${LIGHT},commits,comments`;
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });

function run(cmd, args, { cwd, env, timeout = 4 * 60_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, LEFTHOOK: '0', ...env }, encoding: 'utf8', maxBuffer: 1 << 26, timeout });
  const log = `$ ${cmd} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}${r.error ? `${r.error.message}\n` : ''}`;
  return { ok: r.status === 0 && !r.error, log };
}

// LEFTHOOK=0 (as in CI) keeps a checkout's lefthook hooks out of the commit.
const GIT_ID = ['-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, '-c', 'commit.gpgsign=false'];
// The environment wins over user.*, so set it too (a GIT_AUTHOR_* from the caller would otherwise sign the commit).
const ID_ENV = { GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email };

/** Refresh one PR. Returns { pushed, sha } or { hand: reason, log }, or { error } for a transient skip. */
export function refresh(root, pr, { dryRun }) {
  const pkgs = packagesOf(pr.files);
  const dir = mkdtempSync(join(tmpdir(), 'renovate-refresh-'));
  const wt = join(dir, 'wt');
  const logs = [];
  const step = (cmd, args, opts = {}) => {
    const r = run(cmd, args, { cwd: wt, ...opts });
    logs.push(r.log);
    return r.ok;
  };
  try {
    const f = run('git', ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', `+refs/heads/${pr.headRefName}:refs/remotes/origin/${pr.headRefName}`], { cwd: root });
    if (!f.ok) return { hand: null, log: f.log, error: 'fetch failed' };
    const head = execFileSync('git', ['rev-parse', `refs/remotes/origin/${pr.headRefName}`], { cwd: root, encoding: 'utf8' }).trim();
    if (head !== pr.headRefOid) return { hand: null, error: `the head moved (${pr.headRefOid} → ${head})` };
    execFileSync('git', ['worktree', 'add', '-q', '--detach', wt, head], { cwd: root, stdio: 'ignore' });
    if (!step('git', [...GIT_ID, 'rebase', '-q', 'origin/main'], { env: { GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email } })) {
      step('git', ['rebase', '--abort']);
      return { hand: 'the branch does not rebase onto main cleanly', log: logs.join('\n') };
    }
    const env = { RECIPE_SHA_BASE: 'origin/main' };
    for (const p of pkgs) {
      if (!step(process.execPath, ['scripts/refresh-recipe-sha.mjs', p], { env })) return { hand: `refresh-recipe-sha.mjs ${p} failed`, log: logs.join('\n') };
      if (!step(process.execPath, ['scripts/sync-package-version.mjs', p, '--write'])) return { hand: `sync-package-version.mjs ${p} --write failed`, log: logs.join('\n') };
    }
    if (!step(process.execPath, ['scripts/readme-table.mjs', '--write'])) return { hand: 'readme-table.mjs --write failed', log: logs.join('\n') };
    const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: wt, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3));
    if (!changed.length) return { hand: 'the refresh changed nothing, so recipe-sha failed for another reason', log: logs.join('\n') };
    const stray = strayPaths(changed, pkgs);
    if (stray.length) return { hand: `the refresh wrote files outside the recipe's metadata (${stray.join(', ')})`, log: logs.join('\n') };
    if (!step('git', ['add', '--', ...changed])) return { hand: null, error: 'git add failed', log: logs.join('\n') };
    const msg = [
      'chore: refresh recipe sha256 and package version after version bump',
      '',
      `scripts/renovate-refresh.mjs ran, after rebasing onto main:`,
      ...pkgs.map((p) => `  node scripts/refresh-recipe-sha.mjs ${p} && node scripts/sync-package-version.mjs ${p} --write`),
      '  node scripts/readme-table.mjs --write',
      '',
      `Signed-off-by: ${AUTHOR.name} <${AUTHOR.email}>`,
    ].join('\n');
    if (!step('git', [...GIT_ID, 'commit', '-q', '-m', msg], { env: ID_ENV })) return { hand: null, error: 'git commit failed', log: logs.join('\n') };
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
    if (dryRun) return { pushed: false, sha, log: logs.join('\n') };
    const p = run('git', ['push', '-q', `--force-with-lease=refs/heads/${pr.headRefName}:${head}`, 'origin', `HEAD:refs/heads/${pr.headRefName}`], { cwd: wt });
    if (!p.ok) return { hand: null, error: 'push refused (queued, or the head moved)', log: p.log };
    return { pushed: true, sha };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const started = Date.now();
  let prs = o.prs.length
    ? o.prs.map((n) => JSON.parse(gh(['pr', 'view', String(n), '--repo', o.repo, '--json', FIELDS])))
    : JSON.parse(gh(['pr', 'list', '--repo', o.repo, '--author', 'app/renovate', '--state', 'open', '--limit', '100', '--json', LIGHT]))
        .filter((pr) => !skipReason({ ...pr, commits: [{ authors: [{ login: 'renovate[bot]' }] }], comments: [] }))
        .map((pr) => JSON.parse(gh(['pr', 'view', String(pr.number), '--repo', o.repo, '--json', FIELDS])));
  prs = prs.filter((pr) => {
    const why = skipReason(pr);
    if (why && o.prs.length) console.log(`renovate-refresh: skip #${pr.number}: ${why}`);
    return !why;
  });
  let done = 0;
  for (const pr of prs) {
    if (done >= o.max || (Date.now() - started) / 1000 > o.budget) {
      console.log(`renovate-refresh: budget spent; #${pr.number} waits for the next run`);
      continue;
    }
    done++;
    const r = refresh(root, pr, o);
    if (r.pushed) console.log(`renovate-refresh: PASS #${pr.number} pushed ${r.sha.slice(0, 8)} (${packagesOf(pr.files).join(', ')})`);
    else if (r.sha) console.log(`renovate-refresh: PASS #${pr.number} would push ${r.sha.slice(0, 8)} (--dry-run)\n${r.log}`);
    else if (r.hand) {
      console.log(`renovate-refresh: HAND #${pr.number}: ${r.hand}`);
      if (!o.dryRun) gh(['pr', 'comment', String(pr.number), '--repo', o.repo, '--body', handComment(pr.headRefOid, r.hand, r.log)]);
    } else console.log(`renovate-refresh: skip #${pr.number}: ${r.error}${r.log ? `\n${r.log}` : ''}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`renovate-refresh: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
