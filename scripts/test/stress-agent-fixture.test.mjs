import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { job, text } from './ladder-workflow.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = join(root, 'stress', 'wasi-pnpm-agent');
const agent = join(fixture, 'agent');
const read = (f) => readFileSync(join(agent, f), 'utf8');
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function section(yaml, name, indent) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `${' '.repeat(indent)}${name}:`);
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === '') continue;
    if (l.length - l.trimStart().length <= indent) break;
    out.push(l);
  }
  return out;
}

function pairs(lines, indent) {
  const out = {};
  for (const l of lines) {
    if (l.length - l.trimStart().length !== indent) continue;
    const m = /^\s*('[^']+'|"[^"]+"|[^:\s]+):\s*(.*)$/.exec(l);
    if (m) out[unquote(m[1])] = unquote(m[2]);
  }
  return out;
}

export function lockImporter(lock) {
  const importer = section(section(lock, 'importers', 0).join('\n'), '.', 2);
  const out = {};
  for (const kind of SECTIONS) {
    const lines = section(importer.join('\n'), kind, 4);
    const deps = {};
    let name = null;
    for (const l of lines) {
      const head = /^ {6}('[^']+'|"[^"]+"|[^:\s]+):\s*$/.exec(l);
      if (head) {
        name = unquote(head[1]);
        continue;
      }
      const spec = /^ {8}specifier:\s*(.+)$/.exec(l);
      if (spec && name) deps[name] = unquote(spec[1]);
    }
    if (Object.keys(deps).length) out[kind] = deps;
  }
  return out;
}

export function drift(manifest, lock, workspace) {
  const problems = [];
  const locked = lockImporter(lock);
  for (const kind of SECTIONS) {
    const want = manifest[kind] || {};
    const have = locked[kind] || {};
    for (const [n, v] of Object.entries(want)) {
      if (!(n in have)) problems.push(`${kind} ${n}: ${v} in package.json, missing from pnpm-lock.yaml`);
      else if (have[n] !== v) problems.push(`${kind} ${n}: lockfile ${have[n]}, manifest ${v}`);
    }
    for (const n of Object.keys(have)) if (!(n in want)) problems.push(`${kind} ${n}: in pnpm-lock.yaml, not in package.json`);
  }
  const wantOverrides = pairs(section(workspace, 'overrides', 0), 2);
  const haveOverrides = pairs(section(lock, 'overrides', 0), 2);
  assert.deepEqual(haveOverrides, wantOverrides, 'pnpm-lock.yaml overrides differ from pnpm-workspace.yaml');
  return problems;
}

test("the fixture's pnpm-lock.yaml importer matches agent/package.json and pnpm-workspace.yaml's overrides (homescoop#1729)", () => {
  const manifest = JSON.parse(read('package.json'));
  assert.ok(Object.keys(manifest.dependencies || {}).length, 'agent/package.json has dependencies');
  assert.deepEqual(drift(manifest, read('pnpm-lock.yaml'), read('pnpm-workspace.yaml')), [], 'regenerate it: stress/wasi-pnpm-agent/README.md');
});

test('NEGATIVE: drift() reports a bumped manifest, a dropped and an added dependency, and a changed override', () => {
  const lock = read('pnpm-lock.yaml');
  const workspace = read('pnpm-workspace.yaml');
  const manifest = lockImporter(lock);
  assert.deepEqual(drift(manifest, lock, workspace), []);
  const [first, ...rest] = Object.keys(manifest.dependencies);
  const bumped = { ...manifest, dependencies: { ...manifest.dependencies, [first]: '999.0.0' } };
  assert.match(drift(bumped, lock, workspace).join('\n'), new RegExp(`dependencies ${first.replace(/[/@.]/g, '\\$&')}: lockfile \\S+, manifest 999\\.0\\.0`));
  const added = { ...manifest, dependencies: { ...manifest.dependencies, 'left-pad': '1.3.0' } };
  assert.match(drift(added, lock, workspace).join('\n'), /left-pad: 1\.3\.0 in package\.json, missing from pnpm-lock\.yaml/);
  const dropped = { ...manifest, dependencies: Object.fromEntries(rest.map((n) => [n, manifest.dependencies[n]])) };
  assert.match(drift(dropped, lock, workspace).join('\n'), /in pnpm-lock\.yaml, not in package\.json/);
  assert.throws(() => drift(manifest, lock, workspace.replace(/'-'/, "'1.0.0'")), /overrides differ/);
  const stale = lock.replace(/^( {8}specifier: ).+$/m, (_, head) => `${head}0.0.0`);
  assert.notEqual(stale, lock);
  assert.equal(drift(manifest, stale, workspace).length, 1);
});

test('ladder-build.yml checks the lockfile on pull requests that touch the fixture (stress-lockfile, homescoop#1722)', () => {
  const j = job('stress-lockfile');
  assert.match(j, /^ {4}if: github\.event_name == 'pull_request'$/m);
  assert.match(j, /git diff --quiet HEAD\^1 HEAD -- stress\/wasi-pnpm-agent; then$/m);
  assert.match(j, /pnpm" install --frozen-lockfile --lockfile-only --dir stress\/wasi-pnpm-agent\/agent;/);
  assert.doesNotMatch(j, /--trust-lockfile|minimum-?release-?age/i);
  assert.match(j, /packages\/wasi-pnpm\/package\/package\.json/);
  assert.match(j, /echo "stress-lockfile: PASS /);
  assert.doesNotMatch(j, /id-token|contents: write|secrets\./);
});

test('ladder-build.yml runs agent-loop.mjs daily and on workflow_dispatch (agent-loop, homescoop#1722)', () => {
  const j = job('agent-loop');
  const cron = /github\.event\.schedule == '([^']+)'/.exec(j)?.[1];
  assert.ok(cron, 'agent-loop is gated on its own cron');
  assert.notEqual(cron, '23 * * * *', 'not the hourly issue-labels cron');
  assert.match(text, new RegExp(`^ {4}- cron: '${cron.replace(/\*/g, '\\*')}'$`, 'm'));
  assert.match(j, /github\.event_name == 'workflow_dispatch' && inputs\.agent_loop_rounds != ''/);
  assert.match(text, /^ {6}agent_loop_rounds:$/m);
  assert.match(j, /--cert stress\/wasi-pnpm-agent --spec agent-loop\.mjs/);
  assert.match(j, /node scripts\/gate\.mjs cert-run -- node scripts\/browser-cert\/run\.mjs/);
  assert.match(j, /^ {4}runs-on: ubuntu-latest$/m);
  assert.match(j, /^ {6}contents: read$/m);
  assert.doesNotMatch(j, /id-token|contents: write|secrets\./);
  assert.ok(existsSync(join(fixture, 'agent-loop.mjs')));
});

test("NEGATIVE: stress/wasi-pnpm-agent/meta.json names only workflows and jobs that exist (main's named the agent-loop workflow #1697 deleted)", () => {
  const meta = readFileSync(join(fixture, 'meta.json'), 'utf8');
  for (const [, wf] of meta.matchAll(/([\w.-]+\.ya?ml)\b/g)) {
    if (wf === 'pnpm-lock.yaml' || wf === 'pnpm-workspace.yaml') continue;
    assert.ok(existsSync(join(root, '.github', 'workflows', wf)), `meta.json names ${wf}, which isn't in .github/workflows`);
  }
  assert.match(meta, /ladder-build\.yml's agent-loop job/);
  assert.match(meta, /ladder-build\.yml's stress-lockfile job/);
  job('agent-loop');
  job('stress-lockfile');
});
