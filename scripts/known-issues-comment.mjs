#!/usr/bin/env node
/**
 * Known issues for touched packages: list the open `next-build` issues that
 * name each package a PR touches, so per-recipe known issues get fixed when the
 * recipe is next built. the PR run's known-issues job runs it; it informs and
 * never fails the PR.
 *
 *   node scripts/known-issues-comment.mjs --packages sed,curl --issues issues.json
 *       print the comment body (issues.json: gh issue list --json number,title)
 *   node scripts/known-issues-comment.mjs --base A --head B --pr N [--repo owner/name]
 *       list touched packages and next-build issues with gh, then create or
 *       update the one PR comment (found by its marker and github-actions[bot] as
 *       author, or --bot <login>; never a new one per push)
 *
 * A package is named by an issue when its title contains the npm name
 * (`@ai-ecoverse/wasm-sed` or `wasm-sed`) or `packages/<dir>`, or the bare
 * directory name is a word in the title's lead (the text before its first `:`,
 * after an optional `[cert]` tag, e.g. "which, tree, util-linux: ..."). Only
 * the title counts: bodies mention wasm-bash, wasix-perl and friends as tools
 * in nearly every repro, and issue titles here name the package they are about.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

export const MARKER = '<!-- homescoop:known-issues -->';
export const LABEL = 'next-build';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (s) => new RegExp(`(?<![\\w@/.-])${esc(s)}(?![\\w-])`, 'i');

/**
 * @param {string} dir packages/<dir>
 * @param {string} root
 */
export function packageAliases(dir, root = defaultRoot) {
  const pkgPath = join(root, 'packages', dir, 'package', 'package.json');
  const npm = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')).name : '';
  const anywhere = [`packages/${dir}`];
  if (npm) {
    anywhere.push(npm);
    const short = npm.replace(/^@[^/]+\//, '');
    if (short !== npm) anywhere.push(short);
  }
  return { dir, npm, anywhere: [...new Set(anywhere)] };
}

/** @param {string} title */
export function titleLead(title) {
  const t = title.replace(/^\s*\[[^\]]*\]\s*/, '');
  const i = t.indexOf(':');
  return i >= 0 ? t.slice(0, i) : t.split(/\s+/)[0] || '';
}

/**
 * @param {{ dir: string, anywhere: string[] }} alias
 * @param {{ title: string }} issue
 */
export function issueNames(alias, issue) {
  const text = issue.title;
  if (alias.anywhere.some((a) => (a.includes('/') ? text.includes(a) : word(a).test(text)))) return true;
  return word(alias.dir).test(titleLead(issue.title));
}

/**
 * @param {string[]} dirs
 * @param {{ number: number, title: string }[]} issues
 * @param {string} root
 * @returns {{ dir: string, npm: string, issues: { number: number, title: string }[] }[]}
 */
export function matchIssues(dirs, issues, root = defaultRoot) {
  return dirs.map((dir) => {
    const alias = packageAliases(dir, root);
    const hits = issues
      .filter((i) => issueNames(alias, i))
      .sort((a, b) => a.number - b.number)
      .map(({ number, title }) => ({ number, title }));
    return { dir, npm: alias.npm, issues: hits };
  });
}

/** @param {ReturnType<typeof matchIssues>} matches */
export function renderComment(matches) {
  const hit = matches.filter((m) => m.issues.length);
  const lines = [MARKER, '### Known issues for touched packages', ''];
  if (!hit.length) {
    lines.push(
      `No open \`${LABEL}\` issue names a package this PR touches (${matches.map((m) => `\`${m.dir}\``).join(', ') || 'none'}).`
    );
  } else {
    lines.push(
      `Open issues labelled \`${LABEL}\` that name a package this PR touches. If this PR rebuilds the package, consider fixing them now, or say why not. This comment is informational and updated in place.`,
      ''
    );
    for (const m of hit) {
      lines.push(`**${m.dir}**${m.npm ? ` (\`${m.npm}\`)` : ''}`);
      for (const i of m.issues) lines.push(`- #${i.number} ${i.title.replace(/\r?\n/g, ' ')}`);
      lines.push('');
    }
    while (lines[lines.length - 1] === '') lines.pop();
  }
  return lines.join('\n') + '\n';
}

export const BOT = 'github-actions[bot]';

/**
 * The job's own earlier comment: the marker, written by the workflow token's
 * identity, so nobody else's comment that starts with the marker is taken over.
 * @param {{ id: number, body?: string, user?: { login?: string } }[]} comments
 * @param {string} login
 */
export function findOwnComment(comments, login = BOT) {
  return comments.find((c) => c.user?.login === login && typeof c.body === 'string' && c.body.startsWith(MARKER));
}

function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  let dirs;
  if (opt.packages) dirs = String(opt.packages).split(',').filter(Boolean);
  else if (opt.base && opt.head) {
    const r = spawnSync(
      'node',
      [join(defaultRoot, 'scripts/list-touched-packages.mjs'), '--base', opt.base, '--head', opt.head, '--json'],
      { encoding: 'utf8', cwd: defaultRoot }
    );
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    dirs = JSON.parse(r.stdout);
  } else {
    console.error('usage: known-issues-comment.mjs (--packages a,b | --base A --head B) [--issues file.json] [--pr N [--repo o/n]]');
    process.exit(2);
  }
  const repo = opt.repo || process.env.GITHUB_REPOSITORY;
  const repoArgs = repo ? ['--repo', repo] : [];
  const issues = opt.issues
    ? JSON.parse(readFileSync(opt.issues, 'utf8'))
    : JSON.parse(
        gh(['issue', 'list', ...repoArgs, '--label', LABEL, '--state', 'open', '--limit', '1000', '--json', 'number,title'])
      );
  const matches = matchIssues(dirs, issues);
  const body = renderComment(matches);
  process.stdout.write(body);
  if (!opt.pr) return;
  if (!repo) throw new Error('--pr needs --repo or GITHUB_REPOSITORY');
  const comments = JSON.parse(
    gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${opt.pr}/comments?per_page=100`])
  ).flat();
  const mine = findOwnComment(comments, opt.bot || BOT);
  const any = matches.some((m) => m.issues.length);
  if (!mine && !any) {
    console.error('known-issues: nothing to report and no earlier comment; not commenting');
    return;
  }
  if (mine && mine.body === body) {
    console.error(`known-issues: comment ${mine.id} is already up to date`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'known-issues-'));
  try {
    const f = join(tmp, 'body.json');
    writeFileSync(f, JSON.stringify({ body }));
    if (mine) gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, '--input', f]);
    else gh(['api', '--method', 'POST', `repos/${repo}/issues/${opt.pr}/comments`, '--input', f]);
    console.error(`known-issues: ${mine ? `updated comment ${mine.id}` : 'posted a comment'} on #${opt.pr}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
