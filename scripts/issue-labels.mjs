#!/usr/bin/env node
/**
 * Labels for a homescoop issue, from its title: the one mapping that
 * cert-review, pool-parity, publish-failure and the issues-opened fallback
 * (.github/workflows/issue-labels.yml) share. docs/ci-cert.md, Issue labels.
 *
 *   node scripts/issue-labels.mjs --title '<title>'      print the labels, one per line
 *   node scripts/issue-labels.mjs --event                label the issue in $GITHUB_EVENT_PATH if it has none
 *   node scripts/issue-labels.mjs --backlog [--apply]    every open unlabelled issue (gh); --apply writes
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TRIAGE = 'triage';
export const LABELS = [
  'area:kernel', 'area:sysroot', 'area:python', 'area:toolchain',
  'license', 'supply-chain', 'data-integrity', 'repro', 'cert-coverage',
  'harness', 'docs', 'ci', 'next-build', 'idea', TRIAGE,
];
export const SKIP = new Set([7, 390]);

const TOOLCHAIN = new Set(['wasm-clang', 'wasm-emscripten', 'wasm-binaryen', 'wasi-llvm']);
const PREFIX = /^(wasm|wasi|wasix)-/;

const CLASSES = [
  ['repro', /\bbuild[- ](path|host|checkout|dir(ectory)?|date)s?\b|reproduc|differs? from (npm|(its|their) hosted twins?)|same version|bakes the build/i],
  ['license', /licen[cs]e|notices\b|\bPATENTS\b/i],
  ['supply-chain', /\bsha-?256\b|provenance|attest/i],
  ['data-integrity', /data loss|corrupt|\blos(e|es|t|ing)\b[^:]*\b(keys?|output|data|writes?|files?)\b/i],
  ['cert-coverage', /\bno (\S+ ){0,2}(spec|check)s?\b|not mapped to a spec|cert gaps?\b|spec covers only/i],
  ['harness', /\bharness\b|browser-cert/i],
  ['docs', /\bREADMEs?\b|description says|\bdocs?\//i],
  ['ci', /\b(ladder-(pr|build|merge|automerge)|cert-review|npm-parity|pool-parity|check-no-debug(\.mjs)?|merge queue|merge group)\b|^(ci|publish-failure|pool-parity):/i],
];

export function listPackages(root = ROOT) {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'recipe.yaml'))).sort();
}

function packageOf(word, packages) {
  const w = word.replace(/['’]s$/, '').replace(/[.,;]+$/, '');
  if (!w) return [];
  if (w.includes('*')) {
    const re = new RegExp(`^${w.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return packages.filter((p) => re.test(p) || re.test(`wasm-${p}`));
  }
  if (packages.includes(w)) return [w];
  const bare = w.replace(PREFIX, '');
  if (bare !== w && packages.includes(bare)) return [bare];
  return [];
}

export function parseTitle(title) {
  let rest = String(title).trim();
  const tags = [];
  for (let m; (m = rest.match(/^\[([^\]]+)\]\s*/)); rest = rest.slice(m[0].length)) tags.push(m[1].trim().toLowerCase());
  const kernel = /^slicc-kernel\b\s*:/i.test(rest);
  const colon = rest.indexOf(':');
  const subject = (colon > 0 ? rest.slice(0, colon) : rest).replace(/\([^)]*\)/g, ' ');
  return { tags, kernel, rest, subject };
}

export function packagesIn(title, packages) {
  const { tags, subject } = parseTitle(title);
  const found = new Set();
  for (const t of tags) for (const p of packageOf(t, packages)) found.add(p);
  for (const word of subject.split(/[\s,/]+/).filter(Boolean)) {
    const ps = packageOf(word, packages);
    if (ps.length) ps.forEach((p) => found.add(p));
    else if (word === 'and' || word === '&' || /^-?\d[\w.+-]*$/.test(word) || /^v\d/.test(word)) continue;
    else break;
  }
  return [...found].sort();
}

export function npmPackage(name, packages = listPackages()) {
  return packageOf(String(name).replace(/^@ai-ecoverse\//, ''), packages)[0] || null;
}

export function areaOf(pkg) {
  if (pkg.startsWith('py-') || pkg === 'wasix-python') return 'area:python';
  if (pkg === 'wasix-sysroot') return 'area:sysroot';
  if (TOOLCHAIN.has(pkg) || pkg.startsWith('wasm-go')) return 'area:toolchain';
  return null;
}

export function labelsFor(title, packages = listPackages()) {
  const { tags, kernel, rest } = parseTitle(title);
  const pkgs = packagesIn(title, packages);
  const out = new Set();
  if (kernel) out.add('area:kernel');
  if (/^emscripten\b/i.test(rest)) out.add('area:toolchain');
  for (const p of pkgs) {
    const area = areaOf(p);
    if (area) out.add(area);
  }
  if (tags.includes('cert') && !kernel) out.add('next-build');
  if (tags.includes('repro')) out.add('repro');
  if (pkgs.length && !kernel && !tags.includes('plan')) out.add('next-build');
  for (const [label, re] of CLASSES) if (re.test(rest)) out.add(label);
  if (!out.size) out.add(TRIAGE);
  return LABELS.filter((l) => out.has(l));
}

const COLORS = { [TRIAGE]: 'fbca04' };

async function api(path, { method = 'GET', body } = {}) {
  const repo = process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop';
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === 'GET' && res.status === 404)) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function ensureLabels(labels) {
  for (const name of labels) {
    if ((await api(`/labels/${encodeURIComponent(name)}`)).status !== 404) continue;
    await api('/labels', { method: 'POST', body: { name, color: COLORS[name] || 'ededed', description: name === TRIAGE ? 'no label rule matched: label by hand' : '' } });
  }
}

async function fromEvent() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const issue = event.issue;
  if (!issue || issue.pull_request) return console.log('not an issue');
  if (SKIP.has(issue.number)) return console.log(`#${issue.number} is skipped`);
  const current = (await (await api(`/issues/${issue.number}/labels`)).json()).map((l) => l.name);
  if (current.length) return console.log(`#${issue.number} already has ${current.join(', ')}`);
  const labels = labelsFor(issue.title);
  await ensureLabels(labels);
  await api(`/issues/${issue.number}/labels`, { method: 'POST', body: { labels } });
  console.log(`#${issue.number}: ${labels.join(', ')}`);
}

function backlog(apply) {
  const repo = process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop';
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', repo, '--state', 'open', '--limit', '1000', '--json', 'number,title,labels'], { encoding: 'utf8' }));
  for (const i of issues) {
    if (i.labels.length || SKIP.has(i.number)) continue;
    const labels = labelsFor(i.title);
    console.log(`#${i.number}\t${labels.join(',')}\t${i.title}`);
    if (apply) execFileSync('gh', ['issue', 'edit', String(i.number), '-R', repo, '--add-label', labels.join(',')], { stdio: 'inherit' });
  }
}

async function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  if (at('--title') !== undefined) return console.log(labelsFor(at('--title')).join('\n'));
  if (argv.includes('--event')) return fromEvent();
  if (argv.includes('--backlog')) return backlog(argv.includes('--apply'));
  throw new Error('usage: issue-labels.mjs --title <title> | --event | --backlog [--apply]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
