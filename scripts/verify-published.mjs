#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reportFromEnv } from './publish-failure-issue.mjs';
import { compareVersions } from './npm-parity.mjs';

export function integrityOf(buf) {
  return `sha512-${createHash('sha512').update(buf).digest('base64')}`;
}

export async function verifyPublished({ name, version, integrity }, { fetchVersion, sleep, now, timeoutMs, intervalMs }) {
  const start = now();
  for (;;) {
    const got = await fetchVersion(name, version);
    if (got.status === 200) {
      if (got.integrity === integrity) return { ok: true, got: got.integrity };
      return { ok: false, got: got.integrity, reason: `the registry serves ${got.integrity ?? 'no integrity'}, not ${integrity}` };
    }
    if (now() - start >= timeoutMs) {
      const waited = Math.round(timeoutMs / 1000);
      return { ok: false, reason: `${name}@${version} did not appear on the registry within ${waited}s (last answer: ${got.status})` };
    }
    await sleep(intervalMs);
  }
}

/**
 * After the bytes check: the dist-tags must say what the publish meant (homescoop#1150). The version's own
 * tag points at it, or at a newer version a later publish under that tag put there. A tagged publish
 * (npm-tag, e.g. python3.15) must never leave `latest` on this version. The packument lags, so it polls.
 */
export function tagProblem({ version, tag }, tags, compare = compareVersions) {
  const at = tags?.[tag];
  if (!at) return `npm has no ${tag} dist-tag for this name`;
  if (at !== version && compare(at, version) < 0) return `${tag} is ${at}, not ${version}`;
  if (tag !== 'latest' && tags.latest === version) return `latest moved to ${version}, which was published under --tag ${tag}`;
  return '';
}

export async function verifyTags({ name, version, tag }, { fetchTags, sleep, now, timeoutMs, intervalMs, compare }) {
  const start = now();
  for (;;) {
    const got = await fetchTags(name);
    const problem = got.status === 200 ? tagProblem({ version, tag }, got.tags, compare) : `GET dist-tags answered ${got.status}`;
    // latest landing on a tagged version is final: no later answer can make it right.
    if (!problem) return { ok: true, tags: got.tags };
    if (problem.startsWith('latest moved') || now() - start >= timeoutMs) return { ok: false, tags: got.tags, reason: problem };
    await sleep(intervalMs);
  }
}

async function fetchTags(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags?cb=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, tags: await res.json() };
  } catch (err) {
    return { status: `error ${err.message}` };
  }
}

async function fetchVersion(name, version) {
  try {
    // A hung request counts as one more transient answer, not a hung job.
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(30000) });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, integrity: (await res.json()).dist?.integrity };
  } catch (err) {
    return { status: `error ${err.message}` };
  }
}

function parseArgs(argv) {
  // --timeout bounds only the wait for the version to become visible (a new,
  // large package took about 18 min, homescoop#686); a visible version with
  // another integrity fails at once.
  const args = { tgz: argv[0], timeout: 1800, interval: 15, tag: 'latest', tagTimeout: 300 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--npm') args.npm = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--run-url') args.runUrl = argv[++i];
    else if (a === '--tag') args.tag = argv[++i];
    else if (a === '--tag-timeout') args.tagTimeout = Number(argv[++i]);
    else if (a === '--issue') args.issue = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.tgz || args.tgz.startsWith('-') || !args.npm || !(args.timeout >= 0) || !(args.interval > 0) || !args.tag || !(args.tagTimeout >= 0)) {
    throw new Error('usage: verify-published.mjs <package.tgz> --npm <name> [--tag <npm-tag>] [--timeout <s>] [--tag-timeout <s>] [--interval <s>] [--run-url <url>] [--issue]');
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const buf = readFileSync(args.tgz);
  const { name, version } = JSON.parse(execFileSync('tar', ['-xzOf', args.tgz, 'package/package.json'], { encoding: 'utf8' }));
  if (name !== args.npm) throw new Error(`${args.tgz} is ${name}, not ${args.npm}`);
  const integrity = integrityOf(buf);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const result = await verifyPublished(
    { name, version, integrity },
    {
      fetchVersion,
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      now: () => Date.now(),
      timeoutMs: args.timeout * 1000,
      intervalMs: args.interval * 1000,
    },
  );
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  let tagged = null;
  if (result.ok) {
    console.log(`${name}@${version}: the registry serves ${integrity}, the sha512 of the published package.tgz (sha256 ${sha256})`);
    tagged = await verifyTags(
      { name, version, tag: args.tag },
      { fetchTags, sleep, now: () => Date.now(), timeoutMs: args.tagTimeout * 1000, intervalMs: args.interval * 1000 },
    );
    if (tagged.ok) {
      console.log(`${name}@${version}: dist-tags ${JSON.stringify(tagged.tags)} (published under --tag ${args.tag})`);
      console.log(`verify-published: PASS ${name}@${version} --tag ${args.tag}`);
      return;
    }
    result.ok = false;
    result.got = integrity;
    result.reason = `the bytes are right, but the dist-tags are wrong: ${tagged.reason} (dist-tags ${JSON.stringify(tagged.tags ?? null)})`;
  }
  console.log(`::error::${name}@${version}: ${result.reason}`);
  console.log(`verify-published: FAIL ${name}@${version}`);
  if (args.issue) {
    const body = [
      `ladder-build published or tried to publish **${name}@${version}**, and the registry check failed.`,
      '',
      `- package: \`${name}\``,
      `- version: \`${version}\` (published under \`--tag ${args.tag}\`)`,
      `- run: ${args.runUrl ?? '(not given)'}`,
      `- published package.tgz: \`${integrity}\` (sha256 \`${sha256}\`)`,
      `- registry \`dist.integrity\`: \`${result.got ?? 'never appeared'}\``,
      `- check: ${result.reason}`,
    ].join('\n');
    await reportFromEnv({ title: `publish-failure: ${name}@${version}`, body });
  }
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::verify-published: ${err.message}`);
    process.exit(1);
  });
}
