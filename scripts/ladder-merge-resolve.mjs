#!/usr/bin/env node
/**
 * The publish gate. For a package a push to main touched, find the PR merged
 * as the newest first-parent commit that touched it, and that PR's
 * host-<pkg>-prN artifact from a ladder-build.yml pull_request run at the
 * merged head that concluded success: every job green, so the builds, the
 * cert specs and both reviewers' approval (slicc-shared-web's pipeline) are
 * all behind it. Those bytes, and only those, get published.
 *
 *   node scripts/ladder-merge-resolve.mjs --package <recipe> --sha <pushed head> [--base <sha>] [--out <dir>]
 *   … --dry-run [--pr <n>] [--head <sha>] [--assume-unpublished]
 *
 * --out copies the checked package.tgz to <dir>/package.tgz. It writes
 * decision=publish|skip and certified=<sha256> to GITHUB_OUTPUT.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LADDER = '.github/workflows/ladder-build.yml';

export const PUBLISH_PATH = [
  LADDER,
  'scripts/ladder-merge-resolve.mjs',
  'scripts/merge-group-check.mjs',
  'scripts/list-touched-packages.mjs',
  'scripts/classify-touched-packages.mjs',
  'scripts/read-recipe.mjs',
  'scripts/sync-package-version.mjs',
  'scripts/upstream-version-text.mjs',
  'scripts/gate.mjs',
  'scripts/npm-tag.mjs',
  'scripts/oidc-publish.sh',
  'scripts/npm-publish.mjs',
  'scripts/assert-certified-publish.mjs',
  'scripts/npm-parity.mjs',
  'scripts/tarball-parity.mjs',
  'scripts/diff-published.mjs',
  'scripts/check-exact-pins.mjs',
  'scripts/review-browser.mjs',
  'scripts/browser-cert/context.mjs',
  'scripts/browser-cert/page/',
];

function onPublishPath(file) {
  return PUBLISH_PATH.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

export function publishPathProblem(files, { number, name, version }) {
  const gate = files.filter(onPublishPath);
  if (!gate.length) return '';
  return `PR #${number} changes the publish path (${gate.join(', ')}) and releases ${name}@${version}. Its green pull_request run ran that PR's own copy of the gate, so it vouches for nothing (homescoop#1712). A publish-path change merges without publishing anything: land it in a PR that releases no package, and release ${name} from a later PR`;
}

export function candidateProblems({ artifact, run, jobs, head }) {
  const problems = [];
  if (artifact.expired) problems.push('the artifact has expired');
  if (run.path !== LADDER) problems.push(`run ${run.id} is ${run.path}, not ${LADDER}`);
  if (run.event !== 'pull_request') problems.push(`run ${run.id} is a ${run.event} run, not a pull_request run`);
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
  return problems;
}

export function tarballProblem(got, { name, version }) {
  if (got.digestProblem) return got.digestProblem;
  if (!got.sha) return 'the artifact has no package.tgz';
  if (got.recorded !== got.sha) return `package.tgz is ${got.sha}, but package.tgz.sha256 says ${got.recorded ?? 'nothing'}`;
  if (got.name !== name || got.version !== version) {
    return `package.tgz is ${got.name}@${got.version}, not ${name}@${version}`;
  }
  return '';
}

export async function resolvePackage(ctx, io) {
  const { pkg, name, version, assumeUnpublished } = ctx;
  if (!assumeUnpublished && (await io.published(name, version))) {
    return { decision: 'skip', reason: `${name}@${version} is already on npm`, inputs: { package: pkg } };
  }
  const pr = await io.pullRequest();
  if (!pr) throw new Error('no merged PR for this commit, so there is no reviewed artifact to publish');
  const gateProblem = publishPathProblem(await io.changedFiles(pr), { number: pr.number, name, version });
  if (gateProblem) throw new Error(gateProblem);
  const artifactName = `host-${pkg}-pr${pr.number}`;
  const artifacts = (await io.artifacts(artifactName))
    .filter((a) => a.name === artifactName)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (artifacts.length === 0) throw new Error(`no artifact ${artifactName}`);
  const rejected = [];
  const usable = [];
  for (const artifact of artifacts) {
    const runId = artifact.workflow_run?.id;
    const artifactHead = artifact.workflow_run?.head_sha;
    if (artifactHead !== pr.head) {
      rejected.push(`artifact ${artifact.id}: run ${runId} is at ${artifactHead}, not the merged head ${pr.head}`);
      continue;
    }
    let run;
    let jobs;
    try {
      run = await io.run(runId);
      if (run.head_sha !== pr.head) {
        rejected.push(`artifact ${artifact.id}: run ${run.id} is at ${run.head_sha}, not the merged head ${pr.head}`);
        continue;
      }
      jobs = await io.jobs(run.id);
    } catch (err) {
      rejected.push(`artifact ${artifact.id}: ${err.message}`);
      continue;
    }
    const problems = candidateProblems({ artifact, run, jobs, head: pr.head });
    if (problems.length) rejected.push(`artifact ${artifact.id}: ${problems.join('; ')}`);
    else usable.push({ artifact, run });
  }
  if (usable.length === 0) throw new Error(`no usable ${artifactName}: ${rejected.join(' | ')}`);
  const mismatches = [];
  for (const { artifact, run } of usable) {
    const got = await io.download(artifact);
    const problem = tarballProblem(got, { name, version });
    if (problem) {
      mismatches.push(`artifact ${artifact.id}: ${problem}`);
      continue;
    }
    return {
      decision: 'publish',
      gate: `green ladder-build run ${run.id} of PR #${pr.number}`,
      reason: `${name}@${version} is not on npm; ${artifactName} artifact ${artifact.id} from run ${run.id} at ${pr.head} has sha256 ${got.sha}`,
      tarball: got.tgz,
      inputs: { package: pkg, certified: got.sha, artifact_pr: String(pr.number), artifact_id: String(artifact.id), run: String(run.id) },
    };
  }
  throw new Error(`${artifactName}: ${mismatches.join(' | ')}`);
}

export function zipDigestProblem(artifact, bytes) {
  if (!/^sha256:[0-9a-f]{64}$/.test(String(artifact.digest ?? ''))) return `artifact ${artifact.id} has no sha256 digest`;
  const got = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return got === artifact.digest ? '' : `artifact ${artifact.id} downloaded as ${got}, not its digest ${artifact.digest}`;
}

export function githubApi({ repo, token, retryDelayMs = 2000 }) {
  return async (path, { method = 'GET', body } = {}) => {
    const send = () => fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let res = await send();
    if (method === 'GET' && res.status >= 500) {
      await new Promise((done) => setTimeout(done, retryDelayMs));
      res = await send();
    }
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} returned ${res.status}`), { status: res.status });
    return res;
  };
}

export function githubIo({ repo, token, sha, head, prNumber }) {
  const api = githubApi({ repo, token });
  const unzip = async (artifact) => {
    const res = await api(`/actions/artifacts/${artifact.id}/zip`);
    const dir = mkdtempSync(join(tmpdir(), 'ladder-merge-'));
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(dir, 'artifact.zip'), bytes);
    const digestProblem = zipDigestProblem(artifact, bytes);
    if (digestProblem) return { digestProblem };
    execFileSync('unzip', ['-qo', join(dir, 'artifact.zip'), '-d', join(dir, 'out')]);
    return { dir: join(dir, 'out') };
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
      const prs = prNumber ? [await (await api(`/pulls/${prNumber}`)).json()] : await (await api(`/commits/${sha}/pulls`)).json();
      const pr = prs.find((p) => prNumber || (p.merged_at && p.merge_commit_sha === sha));
      if (!pr) return null;
      return { number: pr.number, head: head || pr.head.sha, author: pr.user.login };
    },
    async changedFiles(pr) {
      return changedFiles(`${sha}^1`, pr.head);
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
      const { dir, digestProblem } = await unzip(artifact);
      if (digestProblem) return { digestProblem };
      const tgz = join(dir, 'package.tgz');
      if (!existsSync(tgz)) return {};
      const shaFile = `${tgz}.sha256`;
      const recorded = existsSync(shaFile) ? readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0] : undefined;
      const pkgJson = execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' });
      const { name, version } = JSON.parse(pkgJson);
      return { sha: createHash('sha256').update(readFileSync(tgz)).digest('hex'), recorded, name, version, tgz };
    },
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') args.pkg = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--head') args.head = argv[++i];
    else if (a === '--pr') args.prNumber = argv[++i];
    else if (a === '--assume-unpublished') args.assumeUnpublished = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const hex40 = /^[0-9a-f]{40}$/;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(args.pkg ?? '') || !hex40.test(args.sha ?? '') || (args.base && !hex40.test(args.base))) {
    throw new Error('usage: ladder-merge-resolve.mjs --package <name> --sha <40-hex pushed head> [--base <40-hex>] [--out <dir>] [--dry-run ...]');
  }
  if ((args.head || args.prNumber || args.assumeUnpublished) && !args.dryRun) {
    throw new Error('--head, --pr and --assume-unpublished need --dry-run');
  }
  if (args.prNumber && !/^[1-9][0-9]*$/.test(args.prNumber)) throw new Error('--pr needs a PR number');
  if (args.head && !hex40.test(args.head)) throw new Error('--head needs a 40-hex commit sha');
  return args;
}

function git(...argv) {
  return execFileSync('git', argv, { encoding: 'utf8' });
}

export function changedFiles(base, head, run = git) {
  return run('diff', '--name-only', '--no-renames', `${base}...${head}`).split('\n').filter(Boolean);
}

export function touchingCommit(pkg, base, head) {
  const paths = [`packages/${pkg}/recipe.yaml`, `packages/${pkg}/package`];
  for (const commit of git('rev-list', '--first-parent', `${base}..${head}`).split('\n').filter(Boolean)) {
    if (git('diff', '--name-only', `${commit}^1`, commit, '--', ...paths).trim()) return commit;
  }
  return head;
}

export function readContext(args, commit) {
  const { name, version } = JSON.parse(git('show', `${commit}:packages/${args.pkg}/package/package.json`));
  return { pkg: args.pkg, name, version, assumeUnpublished: Boolean(args.assumeUnpublished) };
}

async function main(argv) {
  let label = 'ladder-merge-resolve';
  try {
    const args = parseArgs(argv);
    const commit = touchingCommit(args.pkg, args.base ?? `${args.sha}^`, args.sha);
    label = `${args.pkg} at ${commit}${args.dryRun ? ' (dry run)' : ''}`;
    const ctx = readContext(args, commit);
    const io = githubIo({
      repo: process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop',
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
      sha: commit,
      head: args.head,
      prNumber: args.prNumber,
    });
    const result = await resolvePackage(ctx, io);
    const via = result.gate ? ` via ${result.gate}` : '';
    console.log(`${label}: ${result.decision}${via}: ${result.reason}`);
    console.log(`publish inputs ${JSON.stringify(result.inputs)}`);
    if (result.decision === 'publish' && args.out) {
      mkdirSync(args.out, { recursive: true });
      copyFileSync(result.tarball, join(args.out, 'package.tgz'));
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `decision=${result.decision}\ncertified=${result.inputs.certified ?? ''}\n`);
    }
    console.log(`ladder-merge-resolve: PASS ${label}: ${result.decision}`);
  } catch (err) {
    console.log(`::error::${label}: refuse to publish: ${String(err.message).replace(/\s*\n\s*/g, ' ')}`);
    console.log(`ladder-merge-resolve: FAIL ${label}`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
