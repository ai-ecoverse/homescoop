#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globRegExp, toolchainInputs } from './list-touched-packages.mjs';
import { githubApi, githubIo, readContext, resolvePackage, touchingCommit } from './ladder-merge-resolve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MERGE = /^Merge pull request #(\d+) from \S+/;

export function gitIn(cwd) {
  return (...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
}

export function groupMembers(base, head, git) {
  const lines = git('rev-list', '--first-parent', '--parents', '--reverse', `${base}..${head}`).split('\n').filter(Boolean);
  if (!lines.length) throw new Error(`${head} adds no commit to ${base}`);
  return lines.map((line) => {
    const [commit, ...parents] = line.split(' ');
    const message = git('log', '-1', '--format=%B', commit);
    const number = message.match(MERGE)?.[1];
    if (parents.length !== 2 || !number) {
      throw new Error(`${commit} is not a two-parent "Merge pull request #N" commit; the queue must merge with merge commits`);
    }
    return { commit, base: parents[0], head: parents[1], number: Number(number), message };
  });
}

export function treeDigester(git, inputsOf = () => []) {
  const trees = new Map();
  const listing = (commit) => {
    if (!trees.has(commit)) {
      const rows = git('ls-tree', '-r', '--full-tree', commit)
        .split('\n')
        .filter(Boolean)
        .map((l) => ({ path: l.slice(l.indexOf('\t') + 1), line: l }));
      trees.set(commit, rows);
    }
    return trees.get(commit);
  };
  return (commit, pkg) => {
    const res = inputsOf(pkg).map(globRegExp);
    const rows = listing(commit).filter((r) => r.path.startsWith(`packages/${pkg}/`) || res.some((re) => re.test(r.path)));
    return createHash('sha256').update(rows.map((r) => r.line).join('\n')).digest('hex');
  };
}

export async function checkGroup({ head, members, touched, digest, owners: ownerOf, context }, io) {
  const problems = [];
  const notes = [];
  const owners = new Map();
  for (const m of members) {
    const pr = await io.pull(m.number);
    if (pr.state !== 'open') problems.push(`#${m.number} is ${pr.state}, not open`);
    if (pr.head?.sha !== m.head) problems.push(`#${m.number}'s head is ${pr.head?.sha}, but the group merged ${m.head}`);
    m.touched = touched(m);
    for (const pkg of m.touched.all) owners.set(pkg, [...(owners.get(pkg) ?? []), m]);
    notes.push(`#${m.number} at ${m.head} (merge ${m.commit}): ${m.touched.all.join(', ') || 'no package'}`);
  }
  for (const [pkg, ms] of owners) {
    if (ms.length > 1) {
      problems.push(`${pkg}: touched by ${ms.map((m) => `#${m.number}`).join(' and ')} in one group, so no artifact was built from the combined tree; dequeue one, rebase it onto main and let its pull request run rebuild`);
      continue;
    }
    const [m] = ms;
    const [group, built] = [digest(head, pkg), digest(m.head, pkg)];
    if (group !== built) {
      problems.push(`${pkg}: its tree in the group head (${group.slice(0, 12)}) is not the tree #${m.number}'s artifact was built from at ${m.head} (${built.slice(0, 12)}); main changed it since, so rebase #${m.number} and let its pull request run rebuild`);
    }
  }
  for (const m of members) {
    for (const pkg of m.touched.publishable) {
      if (owners.get(pkg)?.length !== 1) continue;
      const lands = ownerOf(pkg);
      if (lands !== m.commit) {
        problems.push(`${pkg}: the push would publish it from ${lands}, not at #${m.number}'s merge ${m.commit}`);
        continue;
      }
      try {
        const r = await resolvePackage(context(pkg, m), io.member(m));
        notes.push(`${pkg}: the push would ${r.decision}: ${r.reason}`);
      } catch (err) {
        problems.push(`${pkg}: the push would refuse to publish #${m.number}: ${err.message}`);
      }
    }
  }
  return { problems, notes };
}

function node(script, ...argv) {
  return JSON.parse(execFileSync('node', [join(root, 'scripts', script), ...argv], { cwd: root, encoding: 'utf8' }).trim() || '[]');
}

function recipeInputs(pkg) {
  const r = node('read-recipe.mjs', pkg, '--json');
  return [...(Array.isArray(r.inputs) ? r.inputs : []), ...toolchainInputs(pkg, root, r)];
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--head') args.head = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.base || !/^[0-9a-f]{40}$/.test(args.head ?? '')) {
    throw new Error('usage: merge-group-check.mjs --base <main ref> --head <40-hex group head>');
  }
  return args;
}

async function main(argv) {
  const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  const repo = process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const api = githubApi({ repo, token });
  let members = [];
  let problems = [];
  try {
    const { base, head } = parseArgs(argv);
    const git = gitIn(root);
    const from = git('merge-base', base, head).trim();
    members = groupMembers(from, head, git);
    const io = {
      pull: async (n) => (await api(`/pulls/${n}`)).json(),
      member: (m) => githubIo({ repo, token, sha: m.commit, head: m.head, prNumber: String(m.number) }),
    };
    const touched = (m) => {
      const { all, host } = node('classify-touched-packages.mjs', '--base', m.base, '--head', m.commit);
      return { all, host, publishable: node('list-touched-packages.mjs', '--base', m.base, '--head', m.commit, '--json', '--publishable') };
    };
    const checked = await checkGroup(
      {
        head,
        members,
        touched,
        digest: treeDigester(git, recipeInputs),
        owners: (pkg) => touchingCommit(pkg, from, head),
        context: (pkg, m) => readContext({ pkg }, m.commit),
      },
      io,
    );
    problems = checked.problems;
    summary(`### merge group ${head} on ${from}`);
    for (const n of checked.notes) {
      console.log(n);
      summary(`- ${n}`);
    }
    for (const p of problems) {
      console.log(`::error::merge group: ${p}`);
      summary(`- **refused:** ${p}`);
    }
  } catch (err) {
    const message = String(err.message).replace(/\s*\n\s*/g, ' ');
    console.log(`::error::merge group check failed closed: ${message}`);
    problems = [message];
  }
  if (problems.length) {
    console.log(`merge-group: FAIL ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`merge-group: PASS ${members.map((m) => `#${m.number}`).join(', ')}: every member's artifact binds to the group head`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
