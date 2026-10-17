#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LADDER_PR = '.github/workflows/ladder-pr.yml';
export const RENOVATE = 'renovate[bot]';
export const CERT_REVIEW = '.github/workflows/cert-review.yml';
const SHA256 = /^[0-9a-f]{64}$/;

export function parseCertLines(message) {
  const lines = [];
  for (const raw of String(message ?? '').split(/\r?\n/)) {
    const m = raw.trim().match(/^certified=(\S*)\s+(\S+)\s+(\S+)/);
    if (m) lines.push({ sha: m[1], name: m[2], version: m[3] });
  }
  return lines;
}

export function certFor(text, name, version) {
  const named = parseCertLines(text).filter((l) => l.name === name);
  const exact = named.filter((l) => l.version === version);
  if (exact.length === 0) return null;
  const stale = named.filter((l) => l.version !== version).map((l) => l.version);
  if (stale.length) {
    throw new Error(`the certified= lines name ${name} ${version} and also ${name} ${stale.join(', ')}`);
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

function runProblems(run) {
  const problems = [];
  if (run.path !== CERT_REVIEW) problems.push(`run ${run.id} is ${run.path}, not ${CERT_REVIEW}`);
  if (run.event !== 'workflow_run' && run.event !== 'workflow_dispatch') problems.push(`run ${run.id} is a ${run.event} run`);
  if (run.head_branch !== 'main') problems.push(`run ${run.id} ran on ${run.head_branch}, not main`);
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    problems.push(`run ${run.id} concluded ${run.conclusion || run.status}`);
  }
  return problems;
}

function recordProblems({ run, artifact, pr }, record) {
  const problems = [];
  if (artifact.name !== `cert-review-record-${pr.number}`) {
    problems.push(`artifact ${artifact.id} is ${artifact.name}, not cert-review-record-${pr.number}`);
  }
  if (artifact.workflow_run?.id !== run.id) problems.push(`artifact ${artifact.id} is from run ${artifact.workflow_run?.id}, not ${run.id}`);
  if (artifact.expired) problems.push(`artifact ${artifact.id} has expired`);
  if (problems.length || record === undefined) return problems;
  if (!record) return [`artifact ${artifact.id} has no record.json`];
  if (record.pr !== pr.number) problems.push(`its record is for PR #${record.pr}, not #${pr.number}`);
  if (record.head !== pr.head) problems.push(`its record is for ${record.head}, not the merged head ${pr.head}`);
  if (record.cert_review_run !== run.id) problems.push(`its record names run ${record.cert_review_run}, not ${run.id}`);
  if (!Array.isArray(record.lines)) problems.push('its record has no lines');
  return problems;
}

async function unlessGone(request) {
  try {
    return await request;
  } catch (err) {
    if (err.status === 404) return undefined;
    throw err;
  }
}

export async function certReview(pr, io) {
  const status = (await io.statuses(pr.head)).find(
    (st) => st.context === 'cert-review' && st.creator?.login === 'github-actions[bot]',
  );
  if (!status) return { state: 'absent' };
  const url = status.target_url ?? '';
  const target = url.match(/\/actions\/runs\/(\d+)\/artifacts\/(\d+)$/);
  if (status.state !== 'success') return { state: status.state, url, runId: target ? Number(target[1]) : undefined };
  const said = String(status.description ?? '').match(/\brun (\d+), record artifact (\d+)$/);
  if (!target || !said || said[1] !== target[1] || said[2] !== target[2]) {
    const problem = `its target_url '${url}' and description '${status.description}' don't name the same run and record artifact`;
    return { state: 'invalid', url, problem };
  }
  const runId = Number(target[1]);
  const found = { run: await unlessGone(io.run(runId)), artifact: await unlessGone(io.artifact(Number(target[2]))), pr };
  if (!found.run || !found.artifact) {
    const gone = !found.run ? `run ${runId}` : `record artifact ${target[2]}`;
    return { state: 'invalid', url, problem: `${gone} no longer exists` };
  }
  let problems = [...runProblems(found.run), ...recordProblems(found)];
  let record;
  if (!problems.length) {
    record = await unlessGone(io.record(found.artifact));
    if (record === undefined) return { state: 'invalid', url, problem: `record artifact ${target[2]} no longer exists` };
    problems = recordProblems(found, record);
  }
  if (problems.length) return { state: 'invalid', url, problem: problems.join('; ') };
  return { state: 'success', url, runId, text: record.lines.join('\n') };
}

function describeReview(review, name, version) {
  if (review.state === 'absent') return 'there is no cert-review status on the merged head';
  if (review.state === 'success') return `cert-review run ${review.runId} has no line for ${name} ${version}`;
  const problem = review.problem ? `: ${review.problem}` : '';
  return `the cert-review status is ${review.state}${problem} (${review.url})`;
}

export async function certifiedSha({ name, version, message }, pr, io) {
  const human = [
    { source: 'merge commit', text: message },
    { source: `PR #${pr.number} body`, text: pr.body },
  ];
  const named = human.some(({ text }) => parseCertLines(text).some((l) => l.name === name));
  const ignored =
    named && !(await io.canWrite(pr.author))
      ? `PR #${pr.number} is by ${pr.author}, who cannot write to this repository`
      : undefined;
  const sources = ignored ? [] : human;
  for (const { source, text } of sources) {
    const certified = certFor(text, name, version);
    if (certified) return { certified, source };
  }
  const review = await certReview(pr, io);
  if (review.text !== undefined) {
    const certified = certFor(review.text, name, version);
    if (certified) return { certified, source: `cert-review run ${review.runId}`, review };
    sources.push({ source: `cert-review run ${review.runId}`, text: review.text });
  }
  const stale = sources.flatMap(({ source, text }) =>
    parseCertLines(text)
      .filter((l) => l.name === name)
      .map((l) => `${l.version} in the ${source}`),
  );
  if (stale.length) {
    throw new Error(`the certified= lines name ${name} ${stale.join(', ')}, but the merged package.json is ${name} ${version}`);
  }
  return { certified: null, ignored, review };
}

export async function resolvePackage(ctx, io) {
  const { pkg, name, version, ciCertified, assumeUnpublished } = ctx;
  if (!assumeUnpublished && (await io.published(name, version))) {
    return { decision: 'skip', reason: `${name}@${version} is already on npm`, inputs: { package: pkg } };
  }
  const pr = await io.pullRequest();
  if (!pr) throw new Error('no merged PR for this commit, so there is no ladder-pr artifact to publish');
  const { certified, source, ignored, review } = await certifiedSha(ctx, pr, io);
  if (!certified && !ciCertified) {
    const why = ignored
      ? `the merge commit's and PR body's certified= lines don't count because ${ignored}`
      : `neither the merge commit nor the PR body has a certified=<sha256> ${name} ${version} line`;
    throw new Error(
      `${name}@${version} is not on npm, ${why}, ${describeReview(review, name, version)}, ` +
        `and ${pkg} is not in scripts/ci-certified.json`,
    );
  }
  if (!certified && (review.state === 'failure' || review.state === 'error')) {
    throw new Error(
      `${name}@${version} has no certified= line, and the cert-review status on ${pr.head} is ${review.state}, ` +
        `which vetoes the ci-job path: cert-review run ${review.runId ?? '(none named)'}, ${review.url}`,
    );
  }
  if (!certified && pr.author !== RENOVATE && (ignored || !(await io.canWrite(pr.author)))) {
    throw new Error(
      `${name}@${version} has no certified= line that counts, and a green ci job only counts on a PR by ` +
        `${RENOVATE} or by a writer: PR #${pr.number} is by ${pr.author}`,
    );
  }
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
  const note = ignored ? ` (certified= lines ignored: ${ignored})` : '';
  if (usable.length === 0) throw new Error(`no usable ${artifactName}${note}: ${rejected.join(' | ')}`);
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
      gate: certified ? `certified= line in the ${source}` : `ci-certified (ladder-pr ci job)${ignored ? `; lines ignored: ${ignored}` : ''}`,
      reason: `${name}@${version} is not on npm; ${artifactName} artifact ${artifact.id} from run ${run.id} at ${pr.head} has sha256 ${got.sha}`,
      inputs: { package: pkg, certified: got.sha, artifact_pr: String(pr.number), artifact_id: String(artifact.id) },
    };
  }
  throw new Error(`${artifactName}${note}: ${mismatches.join(' | ')}`);
}

export function githubApi({ repo, token }) {
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} returned ${res.status}`), { status: res.status });
    return res;
  };
}

export function githubIo({ repo, token, sha, head, prBody, prNumber }) {
  const api = githubApi({ repo, token });
  const unzip = async (artifact) => {
    const res = await api(`/actions/artifacts/${artifact.id}/zip`);
    const dir = mkdtempSync(join(tmpdir(), 'ladder-merge-'));
    writeFileSync(join(dir, 'artifact.zip'), Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-qo', join(dir, 'artifact.zip'), '-d', join(dir, 'out')]);
    return join(dir, 'out');
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
      return { number: pr.number, head: head || pr.head.sha, body: prBody ?? pr.body ?? '', author: pr.user.login };
    },
    async canWrite(login) {
      const res = await fetch(`https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`GET collaborators/${login}/permission returned ${res.status}`);
      return ['admin', 'write'].includes((await res.json()).permission);
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
    async statuses(ref) {
      return (await api(`/commits/${ref}/statuses?per_page=100`)).json();
    },
    async artifact(id) {
      return (await api(`/actions/artifacts/${id}`)).json();
    },
    async record(artifact) {
      const file = join(await unzip(artifact), 'record.json');
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
    async download(artifact) {
      const tgz = join(await unzip(artifact), 'package.tgz');
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
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--head') args.head = argv[++i];
    else if (a === '--message') args.message = argv[++i];
    else if (a === '--pr-body') args.prBody = argv[++i];
    else if (a === '--pr') args.prNumber = argv[++i];
    else if (a === '--ci-certified') args.ciCertified.push(...argv[++i].split(/[\s,]+/).filter(Boolean));
    else if (a === '--assume-unpublished') args.assumeUnpublished = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const hex40 = /^[0-9a-f]{40}$/;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(args.pkg ?? '') || !hex40.test(args.sha ?? '') || (args.base && !hex40.test(args.base))) {
    throw new Error('usage: ladder-merge-resolve.mjs --package <name> --sha <40-hex pushed head> [--base <40-hex>] [--dry-run ...]');
  }
  const overrides =
    args.head ||
    args.prNumber ||
    args.message !== undefined ||
    args.prBody !== undefined ||
    args.ciCertified.length ||
    args.assumeUnpublished;
  if (overrides && !args.dryRun) {
    throw new Error('--head, --pr, --message, --pr-body, --ci-certified and --assume-unpublished need --dry-run');
  }
  if (args.prNumber && !/^[1-9][0-9]*$/.test(args.prNumber)) throw new Error('--pr needs a PR number');
  if (args.head && !/^[0-9a-f]{40}$/.test(args.head)) throw new Error('--head needs a 40-hex commit sha');
  return args;
}

function git(...argv) {
  return execFileSync('git', argv, { encoding: 'utf8' });
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
  let listed = [];
  try {
    listed = JSON.parse(git('show', `${commit}:scripts/ci-certified.json`)).packages ?? [];
  } catch {
    listed = [];
  }
  return {
    pkg: args.pkg,
    name,
    version,
    message: args.message ?? git('log', '-1', '--format=%B', commit),
    ciCertified: listed.includes(args.pkg) || args.ciCertified.includes(args.pkg),
    assumeUnpublished: Boolean(args.assumeUnpublished),
  };
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
      prBody: args.prBody,
      prNumber: args.prNumber,
    });
    const result = await resolvePackage(ctx, io);
    const via = result.gate ? ` via ${result.gate}` : '';
    console.log(`${label}: ${result.decision}${via}: ${result.reason}`);
    console.log(`ladder-build inputs ${JSON.stringify(result.inputs)}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `inputs=${JSON.stringify(result.inputs)}\n`);
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
