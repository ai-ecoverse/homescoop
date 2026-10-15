#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LADDER_PR = '.github/workflows/ladder-pr.yml';
const SHA256 = /^[0-9a-f]{64}$/;

export function parseCertLines(message) {
  const lines = [];
  for (const raw of String(message ?? '').split(/\r?\n/)) {
    const m = raw.trim().match(/^certified=(\S*)\s+(\S+)\s+(\S+)/);
    if (m) lines.push({ sha: m[1], name: m[2], version: m[3] });
  }
  return lines;
}

export function certFor(message, name, version) {
  const named = parseCertLines(message).filter((l) => l.name === name);
  if (named.length === 0) return null;
  const exact = named.filter((l) => l.version === version);
  if (exact.length === 0) {
    const seen = named.map((l) => l.version).join(', ');
    throw new Error(`the certified= line names ${name} ${seen}, but the merged package.json is ${name} ${version}`);
  }
  const bad = exact.find((l) => !SHA256.test(l.sha));
  if (bad) throw new Error(`the certified= line for ${name} ${version} has a malformed sha256 '${bad.sha}'`);
  const shas = [...new Set(exact.map((l) => l.sha))];
  if (shas.length > 1) throw new Error(`conflicting certified= lines for ${name} ${version}: ${shas.join(', ')}`);
  return shas[0];
}

export function candidateProblems({ artifact, run, jobs, head, needCi }) {
  const problems = [];
  if (artifact.expired) problems.push('the artifact has expired');
  if (run.path !== LADDER_PR) problems.push(`run ${run.id} is ${run.path}, not ${LADDER_PR}`);
  if (artifact.workflow_run?.head_sha !== head || run.head_sha !== head) {
    problems.push(`run ${run.id} is at ${run.head_sha}, not the merged head ${head}`);
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    const failed = jobs
      .filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped')
      .map((j) => `${j.name}: ${j.conclusion}`);
    const detail = failed.length ? ` (${failed.join(', ')})` : '';
    problems.push(`run ${run.id} concluded ${run.conclusion || run.status}${detail}`);
  }
  if (needCi) {
    const ci = jobs.find((j) => j.name === 'ci');
    if (ci?.conclusion !== 'success') {
      problems.push(`run ${run.id} has no successful ci job (ci: ${ci ? ci.conclusion || ci.status : 'missing'})`);
    }
  }
  return problems;
}

export function tarballProblem(got, { name, version, certified }) {
  if (!got.sha) return 'the artifact has no package.tgz';
  if (got.recorded !== got.sha) return `package.tgz is ${got.sha}, but package.tgz.sha256 says ${got.recorded ?? 'nothing'}`;
  if (certified && got.sha !== certified) {
    return `package.tgz sha256 ${got.sha} does not match the certified= line ${certified}`;
  }
  if (got.name !== name || got.version !== version) {
    return `package.tgz is ${got.name}@${got.version}, not ${name}@${version}`;
  }
  return '';
}

export async function resolvePackage({ pkg, name, version, message, ciCertified, assumeUnpublished }, io) {
  if (!assumeUnpublished && (await io.published(name, version))) {
    return { decision: 'skip', reason: `${name}@${version} is already on npm`, inputs: { package: pkg } };
  }
  const certified = certFor(message, name, version);
  if (!certified && !ciCertified) {
    throw new Error(
      `${name}@${version} is not on npm, the merge commit has no certified=<sha256> ${name} ${version} line, ` +
        `and ${pkg} is not in scripts/ci-certified.json`,
    );
  }
  const pr = await io.pullRequest();
  if (!pr) throw new Error('no merged PR for this commit, so there is no ladder-pr artifact to publish');
  const artifactName = `host-${pkg}-pr${pr.number}`;
  const artifacts = (await io.artifacts(artifactName))
    .filter((a) => a.name === artifactName)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (artifacts.length === 0) throw new Error(`no artifact ${artifactName}`);
  const rejected = [];
  const usable = [];
  for (const artifact of artifacts) {
    const run = await io.run(artifact.workflow_run?.id);
    const jobs = await io.jobs(run.id);
    const problems = candidateProblems({ artifact, run, jobs, head: pr.head, needCi: !certified });
    if (problems.length) rejected.push(`artifact ${artifact.id}: ${problems.join('; ')}`);
    else usable.push({ artifact, run });
  }
  if (usable.length === 0) throw new Error(`no usable ${artifactName}: ${rejected.join(' | ')}`);
  const mismatches = [];
  for (const { artifact, run } of certified ? usable : usable.slice(0, 1)) {
    const got = await io.download(artifact);
    const problem = tarballProblem(got, { name, version, certified });
    if (problem) {
      mismatches.push(`artifact ${artifact.id}: ${problem}`);
      continue;
    }
    return {
      decision: 'publish',
      gate: certified ? 'certified= line' : 'ci-certified (ladder-pr ci job)',
      reason: `${name}@${version} is not on npm; ${artifactName} artifact ${artifact.id} from run ${run.id} at ${pr.head} has sha256 ${got.sha}`,
      inputs: { package: pkg, certified: got.sha, artifact_pr: String(pr.number), artifact_id: String(artifact.id) },
    };
  }
  throw new Error(`${artifactName}: ${mismatches.join(' | ')}`);
}

function githubIo({ repo, token, sha, head }) {
  const api = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GET ${path} returned ${res.status}`);
    return res;
  };
  return {
    async published(name, version) {
      const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
      const res = await fetch(url);
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`GET ${url} returned ${res.status}`);
    },
    async pullRequest() {
      const prs = await (await api(`/commits/${sha}/pulls`)).json();
      const pr = prs.find((p) => p.merged_at && p.merge_commit_sha === sha);
      return pr ? { number: pr.number, head: head || pr.head.sha } : null;
    },
    async artifacts(name) {
      const q = new URLSearchParams({ name, per_page: '100' });
      return (await (await api(`/actions/artifacts?${q}`)).json()).artifacts ?? [];
    },
    async run(id) {
      return (await api(`/actions/runs/${id}`)).json();
    },
    async jobs(id) {
      return (await (await api(`/actions/runs/${id}/jobs?filter=latest&per_page=100`)).json()).jobs ?? [];
    },
    async download(artifact) {
      const res = await api(`/actions/artifacts/${artifact.id}/zip`);
      const dir = mkdtempSync(join(tmpdir(), 'ladder-merge-'));
      writeFileSync(join(dir, 'artifact.zip'), Buffer.from(await res.arrayBuffer()));
      execFileSync('unzip', ['-qo', join(dir, 'artifact.zip'), '-d', join(dir, 'out')]);
      const tgz = join(dir, 'out', 'package.tgz');
      if (!existsSync(tgz)) return {};
      const shaFile = `${tgz}.sha256`;
      const recorded = existsSync(shaFile) ? readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0] : undefined;
      const pkgJson = execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' });
      const { name, version } = JSON.parse(pkgJson);
      return { sha: createHash('sha256').update(readFileSync(tgz)).digest('hex'), recorded, name, version };
    },
  };
}

export function parseArgs(argv) {
  const args = { ciCertified: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') args.pkg = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--head') args.head = argv[++i];
    else if (a === '--message') args.message = argv[++i];
    else if (a === '--ci-certified') args.ciCertified.push(...argv[++i].split(/[\s,]+/).filter(Boolean));
    else if (a === '--assume-unpublished') args.assumeUnpublished = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(args.pkg ?? '') || !/^[0-9a-f]{40}$/.test(args.sha ?? '')) {
    throw new Error('usage: ladder-merge-resolve.mjs --package <name> --sha <40-hex merge commit> [--dry-run ...]');
  }
  const overrides = args.head || args.message !== undefined || args.ciCertified.length || args.assumeUnpublished;
  if (overrides && !args.dryRun) throw new Error('--head, --message, --ci-certified and --assume-unpublished need --dry-run');
  if (args.head && !/^[0-9a-f]{40}$/.test(args.head)) throw new Error('--head needs a 40-hex commit sha');
  return args;
}

function git(...argv) {
  return execFileSync('git', argv, { encoding: 'utf8' });
}

function readContext(args) {
  const { name, version } = JSON.parse(git('show', `${args.sha}:packages/${args.pkg}/package/package.json`));
  let listed = [];
  try {
    listed = JSON.parse(git('show', `${args.sha}:scripts/ci-certified.json`)).packages ?? [];
  } catch {
    listed = [];
  }
  return {
    pkg: args.pkg,
    name,
    version,
    message: args.message ?? git('log', '-1', '--format=%B', args.sha),
    ciCertified: listed.includes(args.pkg) || args.ciCertified.includes(args.pkg),
    assumeUnpublished: Boolean(args.assumeUnpublished),
  };
}

async function main(argv) {
  let label = 'ladder-merge-resolve';
  try {
    const args = parseArgs(argv);
    label = `${args.pkg} at ${args.sha}${args.dryRun ? ' (dry run)' : ''}`;
    const ctx = readContext(args);
    const io = githubIo({
      repo: process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop',
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
      sha: args.sha,
      head: args.head,
    });
    const result = await resolvePackage(ctx, io);
    const via = result.gate ? ` via ${result.gate}` : '';
    console.log(`${label}: ${result.decision}${via}: ${result.reason}`);
    console.log(`ladder-build inputs ${JSON.stringify(result.inputs)}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `inputs=${JSON.stringify(result.inputs)}\n`);
    }
  } catch (err) {
    console.log(`::error::${label}: refuse to publish: ${String(err.message).replace(/\s*\n\s*/g, ' ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
