import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(repo, '.github/workflows/kernel-compat.yml'), 'utf8').split('\n');

function gateScript() {
  const start = workflow.findIndex((l) => l === '      - id: runners');
  assert.ok(start > 0, 'the gate job has a runners step');
  const run = workflow.findIndex((l, i) => i > start && l === '        run: |');
  assert.ok(run > start, 'the runners step has a run block');
  const body = [];
  for (let i = run + 1; i < workflow.length; i++) {
    const l = workflow[i];
    if (l.trim() && !l.startsWith('          ')) break;
    body.push(l.slice(10));
  }
  return body.join('\n');
}

function gate(env) {
  const dir = mkdtempSync(join(tmpdir(), 'kernel-compat-gate-'));
  try {
    const out = join(dir, 'out');
    const r = spawnSync('bash', ['-c', gateScript()], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: out,
        SAME_REPO_PR: 'false',
        MAIN_EVENT: 'true',
        EVENT: 'workflow_dispatch',
        REF: 'refs/heads/main',
        KERNEL: '1.99.2',
        REFERENCE: '',
        HOMESCOOP_REF: 'main',
        BIOS_REF: 'main',
        RUNNER: 'cloud-run-bench',
        LIGHT: 'cloud-run',
        COMPARE_JS: 'process.exit(1)',
        ...env,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    const outputs = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
    return { ...outputs, log: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an artifact kernel from a trusted main run runs on the pools', () => {
  const g = gate({ EVENT: 'workflow_call', KERNEL: 'kernel-tgz' });
  assert.equal(g.runner, 'cloud-run-bench');
  assert.equal(g['light-runner'], 'cloud-run');
  assert.match(g.log, /artifact kernel kernel-tgz from a main run → pool/);
});

test('an artifact kernel from a same-repo pull request is unchanged: pools', () => {
  const g = gate({ SAME_REPO_PR: 'true', MAIN_EVENT: 'false', EVENT: 'pull_request', REF: 'refs/pull/7/merge', KERNEL: 'kernel-tgz' });
  assert.equal(g.runner, 'cloud-run-bench');
  assert.match(g.log, /a same-repo pull_request/);
});

test('an artifact kernel off main (a branch dispatch, a fork PR) runs hosted', () => {
  for (const env of [
    { MAIN_EVENT: 'false', REF: 'refs/heads/topic', KERNEL: 'kernel-tgz' },
    { MAIN_EVENT: 'false', EVENT: 'pull_request', REF: 'refs/pull/8/merge', KERNEL: 'kernel-tgz' },
  ]) {
    const g = gate(env);
    assert.equal(g.runner, 'ubuntu-latest', JSON.stringify(env));
    assert.equal(g['light-runner'], 'ubuntu-latest');
  }
});

test('an artifact kernel on main with a homescoop-ref off main runs hosted', () => {
  const g = gate({ KERNEL: 'kernel-tgz', HOMESCOOP_REF: 'topic-branch' });
  assert.equal(g.runner, 'ubuntu-latest');
  assert.match(g.log, /homescoop-ref topic-branch is neither main/);
});

test('an npm-shaped kernel that is not slicc-kernel runs hosted, even from main', () => {
  for (const kernel of ['@evil/pkg@1.0.0', '1.0.0 && x', '@ai-ecoverse/slicc-kernel@git+https://x']) {
    const g = gate({ KERNEL: kernel });
    assert.equal(g.runner, 'ubuntu-latest', kernel);
    assert.match(g.log, /is not a published @ai-ecoverse\/slicc-kernel version/);
  }
});

test('a published kernel from main still runs on the pools', () => {
  for (const kernel of ['1.99.2', '@ai-ecoverse/slicc-kernel@1.99.2', '@ai-ecoverse/slicc-kernel@latest']) {
    const g = gate({ KERNEL: kernel });
    assert.equal(g.runner, 'cloud-run-bench', kernel);
    assert.doesNotMatch(g.log, /artifact kernel/);
  }
});

test('a bad reference runs hosted; a good one keeps the pools', () => {
  assert.equal(gate({ REFERENCE: 'file:../k.tgz' }).runner, 'ubuntu-latest');
  assert.equal(gate({ KERNEL: 'kernel-tgz', REFERENCE: '1.98.2' }).runner, 'cloud-run-bench');
});
