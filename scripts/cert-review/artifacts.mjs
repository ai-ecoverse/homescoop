#!/usr/bin/env node
import { appendFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const GATE = 'artifact-pick';
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function normalDigest(d) {
  const s = String(d ?? '').trim().toLowerCase();
  if (!s) return '';
  return s.startsWith('sha256:') ? s : `sha256:${s}`;
}

export function pick({ artifacts, run, expect, guard }) {
  const problems = [];
  const live = artifacts.filter((a) => !a.expired);
  const wanted = new Set(expect.map((e) => e.name));
  if (guard) {
    const re = new RegExp(guard);
    for (const a of live) {
      if (re.test(a.name) && !wanted.has(a.name)) problems.push(`unexpected artifact ${a.name} (id ${a.id}) matches ${guard}`);
    }
  }
  const chosen = [];
  for (const e of expect) {
    const same = live.filter((a) => a.name === e.name);
    if (e.byName) {
      if (same.length > 1) problems.push(`${e.name}: ${same.length} artifacts with that name (${same.map((a) => a.id).join(', ')})`);
      else if (!same.length) {
        if (!e.optional) problems.push(`${e.name}: no artifact`);
      } else if (run !== undefined && Number(same[0].workflow_run?.id) !== Number(run)) problems.push(`${e.name}: artifact ${same[0].id} is from run ${same[0].workflow_run?.id}, not ${run}`);
      else if (!DIGEST.test(String(same[0].digest ?? ''))) problems.push(`${e.name}: artifact ${same[0].id} has no sha256 digest`);
      else chosen.push({ name: e.name, id: same[0].id, digest: same[0].digest });
      continue;
    }
    const id = e.id === undefined || e.id === null || e.id === '' ? null : Number(e.id);
    if (id === null) {
      if (same.length) problems.push(`${e.name}: artifact ${same.map((a) => a.id).join(', ')} exists, but its producer reported none`);
      else if (!e.optional) problems.push(`${e.name}: no artifact`);
      continue;
    }
    if (same.length !== 1) {
      problems.push(`${e.name}: ${same.length} artifacts with that name (${same.map((a) => a.id).join(', ') || 'none'}), want exactly its producer's ${id}`);
      continue;
    }
    const [a] = same;
    if (a.id !== id) {
      problems.push(`${e.name}: artifact ${a.id} is not the producer's ${id}`);
      continue;
    }
    if (run !== undefined && Number(a.workflow_run?.id) !== Number(run)) {
      problems.push(`${e.name}: artifact ${a.id} is from run ${a.workflow_run?.id}, not ${run}`);
      continue;
    }
    if (!DIGEST.test(String(a.digest ?? ''))) {
      problems.push(`${e.name}: artifact ${a.id} has no sha256 digest`);
      continue;
    }
    const want = normalDigest(e.digest);
    if (!want) {
      problems.push(`${e.name}: its producer reported id ${id} but no digest`);
      continue;
    }
    if (want !== a.digest) {
      problems.push(`${e.name}: artifact ${a.id} digest ${a.digest} is not the producer's ${want}`);
      continue;
    }
    chosen.push({ name: a.name, id: a.id, digest: a.digest });
  }
  return { problems, chosen, ids: chosen.map((c) => c.id).join(',') };
}

export function discover({ artifacts, pattern }) {
  const re = new RegExp(pattern);
  const live = artifacts.filter((a) => !a.expired && re.test(a.name));
  const problems = [];
  const byName = new Map();
  for (const a of live) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);
  const found = [];
  for (const [name, list] of byName) {
    if (list.length !== 1) problems.push(`${name}: ${list.length} artifacts with that name (${list.map((a) => a.id).join(', ')})`);
    else if (!DIGEST.test(String(list[0].digest ?? ''))) problems.push(`${name}: artifact ${list[0].id} has no sha256 digest`);
    else found.push({ name, id: list[0].id, digest: list[0].digest, match: name.match(re) });
  }
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { problems, found };
}

export async function listRunArtifacts({ repo, run, token, fetchImpl = fetch }) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs/${run}/artifacts?per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GET runs/${run}/artifacts returned ${res.status}`);
    const { artifacts = [], total_count: total = 0 } = await res.json();
    all.push(...artifacts);
    if (!artifacts.length || all.length >= total) return all;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      run: { type: 'string' },
      expect: { type: 'string' },
      guard: { type: 'string' },
    },
  });
  try {
    if (!values.repo || !values.run || !values.expect) throw new Error('usage: artifacts.mjs --repo <owner/name> --run <id> --expect <json [{name, id, digest, optional}]> [--guard <regex>]');
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GH_TOKEN is not set');
    const expect = JSON.parse(values.expect);
    if (!Array.isArray(expect)) throw new Error('--expect is not a JSON array');
    const artifacts = await listRunArtifacts({ repo: values.repo, run: values.run, token });
    const { problems, chosen, ids } = pick({ artifacts, run: values.run, expect, guard: values.guard });
    for (const c of chosen) console.log(`${c.name}: artifact ${c.id} ${c.digest}`);
    const single = chosen.length === 1 ? chosen[0].name : '';
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ids=${ids}\nsingle=${single}\n`);
    if (problems.length) {
      for (const p of problems) console.log(`::error::${p}`);
      console.log(`${GATE}: FAIL ${problems.length} problem(s) in run ${values.run}: ${problems[0]}`);
      process.exit(1);
    }
    console.log(`${GATE}: PASS run ${values.run}: ${chosen.length} artifact(s) by id and digest${values.guard ? `, nothing else matches ${values.guard}` : ''}`);
  } catch (err) {
    console.log(`${GATE}: FAIL ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
