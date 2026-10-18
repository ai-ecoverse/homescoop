#!/usr/bin/env node
// cert-review's only path to a `[cert]` issue (PM decision, 2026-10-18). The same failure gives one
// issue plus one comment per new sighting, not a new issue per run.
//
// The dedupe key is package + failing case + kernel line:
// - package: the recipe dir (`bash`, `wasi-uv`, `slicc-kernel` for a kernel problem); an npm name
//   (`@ai-ecoverse/wasm-bash`) or a `wasm-` prefix is mapped to the recipe dir when one exists.
// - case: `<spec>:<case>`. The spec is the cert file's basename without `.mjs` (`cert/flock.mjs` and
//   `flock` are the same); the case is the assertion or check, trimmed, whitespace collapsed,
//   lowercased. For a finding that isn't a spec failure (notices, meta.json, a build property),
//   name the check: `notices:BLAKE3`, `meta:patches`, `repro:build dir`.
// - kernel line: the slicc-kernel version's major.minor (`1.122.2` → `1.122`), so a patch release
//   of the kernel doesn't make a new issue. `any` (the default) for a failure that doesn't depend on
//   the kernel, which is most of them: pass `--kernel` only when the failure does.
// The key is `v1 ` + the first 16 hex digits of sha256("v1\n<package>\n<spec>:<case>\n<line>"). It
// is written into the issue body as `<!-- cert-review-key: v1 <hex> -->`. An open issue in the
// repository with that marker gets a comment (run link, PR, package version) instead of a new issue;
// a closed one doesn't count, so a failure that comes back after a fix gets a new issue.
//
// It prints the issue as `#<n>` on stdout (diagnostics go to stderr); cite that in verdict.json's `known`.
//   node file-issue.mjs --package <recipe> --case <spec>:<case> [--kernel <version|line|any>] \
//     --title '[cert] <package>: …' --body-file <file> [--label <l>]… [--repo homescoop|slicc-kernel|owner/repo] \
//     [--run <url>] [--pr <n>] [--version <v>] [--note <text>]
//   node file-issue.mjs --kind coverage --package <recipe> --body-file <file>   a coverage gap
//   node file-issue.mjs --list --package <recipe>     the open marked issues of a package, with their cases
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsFor } from '../issue-labels.mjs';

export const VERSION = 'v1';
export const MARKER_RE = /<!-- cert-review-key: (v\d+ [0-9a-f]{16}) -->/;
const PARTS_RE = /<!-- cert-review-key-parts: (.*?) -->/;

export function packageOf(name, root = process.cwd()) {
  let p = String(name ?? '').trim().replace(/^@ai-ecoverse\//, '').replace(/@[^@/]*$/, '');
  if (!p) throw new Error('--package is required');
  if (!existsSync(join(root, 'packages', p)) && p.startsWith('wasm-') && existsSync(join(root, 'packages', p.slice(5)))) p = p.slice(5);
  return p.toLowerCase();
}

export const COVERAGE = 'coverage';
export const isCoverage = (kase) => kase === COVERAGE;
export const coverageTitle = (pkg) => `[cert] ${pkg}: cert coverage gaps`;

export function caseOf(text) {
  const s = String(text ?? '').trim();
  if (!s) throw new Error('--case is required (<spec>:<case>)');
  const at = s.indexOf(':');
  const spec = (at < 0 ? s : s.slice(0, at)).trim().replace(/^.*\//, '').replace(/\.mjs$/i, '').toLowerCase();
  const name = (at < 0 ? '' : s.slice(at + 1)).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!spec) throw new Error(`--case ${JSON.stringify(s)} has no spec before the colon`);
  if (spec === COVERAGE) return COVERAGE;
  return `${spec}:${name}`;
}

export function kernelLine(text) {
  const s = String(text ?? '').trim().replace(/^.*slicc-kernel@/, '').replace(/^v/, '');
  if (!s || /^(any|none|-)$/i.test(s)) return 'any';
  const m = s.match(/^(\d+)\.(\d+)(?:[.-]|$)/);
  if (!m) throw new Error(`--kernel ${JSON.stringify(text)} is not a slicc-kernel version (x.y or x.y.z) or "any"`);
  return `${Number(m[1])}.${Number(m[2])}`;
}

export function keyOf({ pkg, kase, kernel }) {
  const src = `${VERSION}\n${pkg}\n${kase}\n${kernel}`;
  return `${VERSION} ${createHash('sha256').update(src).digest('hex').slice(0, 16)}`;
}

export const markerOf = (key) => `<!-- cert-review-key: ${key} -->`;
// An HTML comment can't hold "--"; the parts are only for humans and --list.
const partsOf = ({ pkg, kase, kernel }) => `<!-- cert-review-key-parts: ${JSON.stringify({ package: pkg, case: kase, kernel }).replace(/--/g, '-\\u002d')} -->`;

export function keyIn(body) {
  return String(body ?? '').match(MARKER_RE)?.[1] ?? null;
}

function partsIn(body) {
  const m = String(body ?? '').match(PARTS_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function repoOf(repo, fallback = process.env.GH_REPO || process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop') {
  if (!repo) return fallback;
  if (repo.includes('/')) return repo;
  return `ai-ecoverse/${repo}`;
}

export function issueBody({ body, key, parts, sighting }) {
  return [
    String(body).trimEnd(),
    '',
    '---',
    `Filed by cert-review (${sighting}). Dedupe key: package \`${parts.pkg}\`, case \`${parts.kase}\`, kernel line \`${parts.kernel}\`. A later run that hits the same key comments here instead of filing again (\`scripts/cert-review/file-issue.mjs\`).`,
    markerOf(key),
    partsOf(parts),
    '',
  ].join('\n');
}

export function sightingOf({ run, pr, pkg, version }) {
  return [run ? `run ${run}` : 'run unknown', pr ? `PR #${pr}` : null, `${pkg}${version ? `@${version}` : ''}`].filter(Boolean).join(', ');
}

// The GitHub REST calls this needs; tests pass a fake with the same shape.
export function githubIssues({ repo, token, fetchImpl = fetch }) {
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`${method} ${repo}${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
    return res.json();
  };
  return {
    async openIssues() {
      const all = [];
      for (let page = 1; ; page++) {
        const batch = await call(`/issues?state=open&per_page=100&page=${page}`);
        all.push(...batch.filter((i) => !i.pull_request));
        if (batch.length < 100) return all;
      }
    },
    comment: (number, body) => call(`/issues/${number}/comments`, { method: 'POST', body: { body } }),
    create: (issue) => call('/issues', { method: 'POST', body: issue }),
  };
}

export async function fileIssue(gh, { pkg, kase, kernel, title, body, labels = [], run, pr, version, note }) {
  const coverage = isCoverage(kase);
  if (coverage) {
    kernel = 'any';
    title = coverageTitle(pkg);
    labels = [...new Set([...labels, ...labelsFor(title, [pkg]).filter((l) => l !== 'triage'), 'cert-coverage'])];
  }
  if (!/^\[cert\] \S/.test(String(title ?? ''))) throw new Error(`--title must start with "[cert] <package>: " (got ${JSON.stringify(title)})`);
  if (!String(body ?? '').trim()) throw new Error('--body-file is empty');
  const parts = { pkg, kase, kernel };
  const key = keyOf(parts);
  const sighting = sightingOf({ run, pr, pkg, version });
  const same = (await gh.openIssues()).filter((i) => keyIn(i.body) === key).sort((a, b) => a.number - b.number);
  if (same.length) {
    const n = same[0].number;
    const text = coverage
      ? [`New coverage gap from cert-review: ${sighting}.`, '', String(body).trim(), note ? `\n${String(note).trim()}` : ''].join('\n')
      : [`Seen again by cert-review: ${sighting}.`, note ? `\n${String(note).trim()}` : ''].join('');
    await gh.comment(n, text.trimEnd() + '\n');
    return { action: 'commented', number: n, key };
  }
  const first = coverage ? `Cert coverage gaps of \`${pkg}\`: specs cert-review suggests. These are suggestions, not defects. Each later gap is added as a comment.\n\n${String(body).trim()}` : body;
  const issue = { title, body: issueBody({ body: first, key, parts, sighting }), ...(labels.length ? { labels } : {}) };
  let created;
  try {
    created = await gh.create(issue);
  } catch (err) {
    if (!labels.length || err.status !== 422) throw err;
    console.error(`file-issue: creating with labels ${labels.join(', ')} failed (${err.message}); filing without them, issue-labels labels it`);
    const { labels: _, ...bare } = issue;
    created = await gh.create(bare);
  }
  return { action: 'opened', number: created.number, key };
}

export async function listKeys(gh, pkg) {
  return (await gh.openIssues())
    .map((i) => ({ number: i.number, title: i.title, key: keyIn(i.body), parts: partsIn(i.body) }))
    .filter((i) => i.key && i.parts?.package === pkg);
}

function parseArgs(argv) {
  const out = { labels: [] };
  const flags = new Set(['--list']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) {
      out[a.slice(2)] = true;
      continue;
    }
    if (!a.startsWith('--') || i + 1 >= argv.length) throw new Error(`unexpected argument ${a}`);
    const v = argv[++i];
    if (a === '--label') out.labels.push(v);
    else if (a === '--kind') {
      if (v !== COVERAGE) throw new Error(`--kind ${JSON.stringify(v)}: only "coverage" is known`);
      out.kind = v;
    } else out[a.slice(2)] = v;
  }
  if (out.kind) {
    if (out.case && caseOf(out.case) !== COVERAGE) throw new Error(`--kind coverage and --case ${JSON.stringify(out.case)} conflict: a coverage gap has no case of its own`);
    out.case = COVERAGE;
  }
  return out;
}

export function versionOf(pkg, root = process.cwd()) {
  try {
    return JSON.parse(readFileSync(join(root, 'packages', pkg, 'package', 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export async function main(argv, { gh: given, env = process.env, root = process.cwd(), out = console.log, err = console.error } = {}) {
  const a = parseArgs(argv);
  const repo = repoOf(a.repo, env.GH_REPO || env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop');
  const gh = given ?? githubIssues({ repo, token: env.GH_TOKEN || env.GITHUB_TOKEN });
  const pkg = packageOf(a.package, root);
  if (a.list) {
    const rows = await listKeys(gh, pkg);
    for (const r of rows) out(`#${r.number}\t${r.parts.case}\tkernel ${r.parts.kernel}\t${r.title}`);
    if (!rows.length) err(`file-issue: no open marked issue for ${pkg} in ${repo}`);
    return 0;
  }
  if (!a['body-file']) throw new Error('--body-file is required');
  if (a.case && caseOf(a.case) === COVERAGE && a.kernel && kernelLine(a.kernel) !== 'any') err(`file-issue: a coverage gap doesn't depend on the kernel; ignoring --kernel ${a.kernel}`);
  const r = await fileIssue(gh, {
    pkg,
    kase: caseOf(a.case),
    kernel: kernelLine(a.kernel),
    title: a.title,
    body: readFileSync(a['body-file'], 'utf8'),
    labels: a.labels,
    run: a.run || env.RUN_URL,
    pr: a.pr || env.PR_NUMBER,
    version: a.version || versionOf(pkg, root),
    note: a.note,
  });
  err(`file-issue: ${r.action === 'opened' ? 'opened' : 'commented on'} ${repo}#${r.number} (key ${r.key})`);
  out(repo === repoOf(undefined, env.GH_REPO || env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop') ? `#${r.number}` : `${repo}#${r.number}`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`file-issue: ${e.message}`);
      process.exit(2);
    }
  );
}
