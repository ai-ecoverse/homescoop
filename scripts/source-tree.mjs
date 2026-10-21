#!/usr/bin/env node
/**
 * Check a source archive's contents against a pinned git tree (#1267).
 *
 *   node scripts/source-tree.mjs <archive> --repo <git url> --commit <sha> --tree <sha>
 *
 * Fetches <commit> from <repo> (depth 1), checks that its tree is <tree>,
 * then compares the archive's files with that tree using git's own
 * attribute handling: eol conversions are undone by git's clean filter, and
 * the only differences allowed are files git marks export-subst (rewritten
 * by git archive) or export-ignore (left out of it). Prints
 * `source-tree: PASS|FAIL …`.
 */
import { closeSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GITHUB_ARCHIVE = [
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/([0-9a-f]{40})\.(?:tar\.gz|tgz|zip)$/,
  /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/(?:tar\.gz|zip|legacy\.tar\.gz)\/([0-9a-f]{40})$/,
];

/** { repo, commit } for a GitHub archive URL of a commit, else null. */
export function githubArchive(url) {
  for (const re of GITHUB_ARCHIVE) {
    const m = String(url).match(re);
    if (m) return { repo: `https://github.com/${m[1]}/${m[2]}.git`, commit: m[3] };
  }
  return null;
}

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

/**
 * @param {{ archive: string, repo: string, commit: string, tree: string }} o
 * @returns {{ ok: boolean, tree: string, subst: string[], ignored: string[], problems: string[] }}
 */
export const SUBST_VALUE = /^[A-Za-z0-9._+~:/ -]{0,200}$/;

export function checkArchiveTree({ archive, repo, commit, tree, allowSubst }) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-tree-'));
  try {
    const gitDir = join(dir, 'git');
    const x = join(dir, 'x');
    mkdirSync(x);
    execFileSync('git', ['init', '-q', '--bare', gitDir], { env: gitEnv });
    const git = (args, work = null) =>
      execFileSync(
        'git',
        [
          `--git-dir=${gitDir}`,
          ...(work ? [`--work-tree=${work}`] : []),
          '-c', 'core.autocrlf=false',
          '-c', 'core.fileMode=true',
          '-c', 'core.symlinks=true',
          '-c', 'core.excludesFile=/dev/null',
          ...args,
        ],
        { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...gitEnv, GIT_INDEX_FILE: join(dir, 'index') }, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    git(['fetch', '-q', '--depth=1', '--no-tags', repo, commit]);
    const got = git(['rev-parse', `${commit}^{tree}`]).trim();
    if (got !== tree) return { ok: false, tree: got, subst: [], values: {}, ignored: [], problems: [`commit ${commit} has tree ${got}, not the pinned ${tree}`] };

    const magic = Buffer.alloc(4);
    const fd = openSync(archive, 'r');
    readSync(fd, magic, 0, 4, 0);
    closeSync(fd);
    if (magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) execFileSync('unzip', ['-q', archive, '-d', x]);
    else execFileSync('tar', ['-xf', archive, '-C', x]);
    const top = readdirSync(x);
    const work = top.length === 1 && statSync(join(x, top[0])).isDirectory() ? join(x, top[0]) : x;

    git(['read-tree', commit]);
    try {
      git(['update-index', '-q', '--refresh'], work);
    } catch {
      /* exits 1 when files differ; diff-files lists them */
    }
    const diff = git(['diff-files', '--name-status', '-z'], work).split('\0').filter(Boolean);
    const others = git(['ls-files', '--others', '-z'], work).split('\0').filter(Boolean);
    const attrs = (attr, paths) => {
      if (!paths.length) return new Set();
      const out = git(['check-attr', '--cached', '-z', attr, '--', ...paths]).split('\0');
      const set = new Set();
      for (let i = 0; i + 2 < out.length; i += 3) if (out[i + 2] === 'set') set.add(out[i]);
      return set;
    };
    const modified = [];
    const deleted = [];
    const problems = [];
    for (let i = 0; i + 1 < diff.length; i += 2) {
      if (diff[i] === 'M' || diff[i] === 'T') modified.push(diff[i + 1]);
      else if (diff[i] === 'D') deleted.push(diff[i + 1]);
      else problems.push(`${diff[i]} ${diff[i + 1]}`);
    }
    const marked = attrs('export-subst', modified);
    const narrow = Array.isArray(allowSubst);
    const listed = new Set(narrow ? allowSubst : []);
    const subst = new Set();
    const values = {};
    for (const p of marked) {
      if (narrow && !listed.has(p)) continue;
      const blob = git(['cat-file', 'blob', `:${p}`]);
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${blob.split(/\$Format:[^$]*\$/).map(esc).join('([^\\n]*)')}$`);
      const m = re.exec(readFileSync(join(work, p), 'utf8'));
      if (!m) continue;
      const found = m.slice(1);
      if (narrow) {
        const bad = found.find((v) => !SUBST_VALUE.test(v));
        if (bad !== undefined) {
          problems.push(`export-subst value in ${p} is not one line of [A-Za-z0-9._+~:/ -] up to 200 characters: ${JSON.stringify(bad.slice(0, 80))}`);
          subst.add(p);
          continue;
        }
      }
      subst.add(p);
      values[p] = found;
    }
    const ignore = attrs('export-ignore', deleted);
    for (const p of modified) if (!subst.has(p)) problems.push(`differs from the tree${narrow && marked.has(p) && !listed.has(p) ? ' (export-subst, not in source.tree_subst)' : ''}: ${p}`);
    for (const p of deleted) if (!ignore.has(p)) problems.push(`missing from the archive: ${p}`);
    for (const p of others) problems.push(`not in the tree: ${p}`);
    if (narrow) {
      const all = git(['ls-files', '-z']).split('\0').filter(Boolean);
      const declared = new Set();
      const out = execFileSync('git', [`--git-dir=${gitDir}`, 'check-attr', '--cached', '-z', '--stdin', 'export-ignore'], { input: all.join('\0'), encoding: 'utf8', maxBuffer: 1 << 28, env: { ...gitEnv, GIT_INDEX_FILE: join(dir, 'index') } }).split('\0');
      for (let i = 0; i + 2 < out.length; i += 3) if (out[i + 2] === 'set') declared.add(out[i]);
      const gone = new Set(deleted);
      const inTree = new Set(all);
      for (const p of declared) if (!gone.has(p)) problems.push(`export-ignore in the tree's .gitattributes but present in the archive: ${p}`);
      for (const p of listed) if (!inTree.has(p)) problems.push(`source.tree_subst lists ${p}, which isn't in the tree`);
    }
    return { ok: problems.length === 0, tree: got, subst: [...subst], values, ignored: [...ignore], problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One log line for a result. */
export function describe(r, tree) {
  if (r.ok) {
    const extra = [r.subst.length ? `export-subst ${r.subst.join(',')}` : '', r.ignored.length ? `export-ignore ${r.ignored.length}` : '']
      .filter(Boolean)
      .join('; ');
    return `source-tree: PASS archive matches tree ${tree}${extra ? ` (${extra})` : ''}`;
  }
  const shown = r.problems.slice(0, 5).join('; ');
  return `source-tree: FAIL archive does not match tree ${tree}: ${shown}${r.problems.length > 5 ? `; and ${r.problems.length - 5} more` : ''}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const opt = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : '';
  };
  const archive = a[0];
  const repo = opt('--repo');
  const commit = opt('--commit');
  const tree = opt('--tree');
  if (!archive || !repo || !commit || !tree) {
    console.error('usage: source-tree.mjs <archive> --repo <git url> --commit <sha> --tree <sha>');
    process.exit(2);
  }
  const r = checkArchiveTree({ archive, repo, commit, tree });
  console.log(describe(r, tree));
  process.exit(r.ok ? 0 : 1);
}
