import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findVerdict, judge, verdictLine } from '../gate.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(scripts, '..');
const gate = (name, js) => spawnSync(process.execPath, [join(scripts, 'gate.mjs'), name, '--', process.execPath, '-e', js], { encoding: 'utf8' });

const GATES = {
  'exact-pins': 'scripts/check-exact-pins.mjs',
  'package-meta': 'scripts/check-package-meta.mjs',
  'npm-parity': 'scripts/npm-parity.mjs',
  'recipe-sha': 'scripts/refresh-recipe-sha.mjs',
  'prove-negative': 'scripts/browser-cert/prove-negative.mjs',
  'cert-leg': 'scripts/browser-cert/cert-leg.mjs',
  'cert-run': 'scripts/browser-cert/run.mjs',
  'kernel-compat': 'scripts/browser-cert/compat.mjs',
  'cert-kernel': 'scripts/check-cert-kernel.mjs',
  'certified-publish': 'scripts/assert-certified-publish.mjs',
  'verify-published': 'scripts/verify-published.mjs',
  'cert-verdict': 'scripts/cert-review/verdict.mjs',
};

test('judge: only a verdict that agrees with the exit status passes', () => {
  assert.deepEqual(judge('g', 0, 'g: PASS 3 things\n'), { code: 0, message: '' });
  assert.equal(judge('g', 0, 'all fine\n').code, 1);
  assert.equal(judge('g', 0, '').code, 1);
  assert.equal(judge('g', 0, 'g: FAIL nope\n').code, 1);
  assert.equal(judge('g', 3, 'g: PASS\n').code, 3);
  assert.deepEqual(judge('g', 4, 'g: FAIL broke\n'), { code: 4, message: '' });
  assert.equal(judge('g', 4, 'nothing\n').code, 4);
  assert.equal(judge('g', 0, 'other: PASS\nxg: PASS\n g: PASS\n').code, 1);
  assert.equal(findVerdict('g', 'g: FAIL a\ng: PASS b\n').verdict, 'PASS');
  assert.equal(verdictLine('g', false, 'why'), 'g: FAIL why');
});

for (const name of [...Object.keys(GATES), 'kernel-compat-plan', 'kernel-compat-shard', 'pool-parity', 'host-smoke']) {
  test(`${name}: a stubbed early exit 0 with no verdict fails its caller (#981)`, () => {
    const silent = gate(name, 'process.exit(0)');
    assert.equal(silent.status, 1, silent.stdout);
    assert.match(silent.stderr, new RegExp(`::error::${name}: no "${name}: PASS\\|FAIL" verdict line \\(exit 0\\)`));
    const pass = gate(name, `console.log(${JSON.stringify(`${name}: PASS stub`)})`);
    assert.equal(pass.status, 0, pass.stdout);
    const lies = gate(name, `console.log(${JSON.stringify(`${name}: FAIL stub`)})`);
    assert.equal(lies.status, 1, lies.stdout);
    const fails = gate(name, `console.error(${JSON.stringify(`${name}: FAIL stub`)}); process.exit(5)`);
    assert.equal(fails.status, 5, fails.stdout);
  });
}

test('every gate script prints its own verdict line', () => {
  for (const [name, file] of Object.entries(GATES)) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.match(text, new RegExp(`(?:say|finish)\\(\\s*'${name}'|const gate = .*'${name}'`), `${file} prints no ${name} verdict`);
  }
});

test('the real gates say PASS or FAIL: exact-pins and package-meta on this tree', () => {
  const pins = spawnSync(process.execPath, [join(scripts, 'check-exact-pins.mjs'), 'git'], { encoding: 'utf8', cwd: root });
  assert.equal(pins.status, 0, pins.stderr);
  assert.match(pins.stdout, /^exact-pins: PASS 1 package\.json$/m);
  const meta = spawnSync(process.execPath, [join(scripts, 'check-package-meta.mjs'), 'git'], { encoding: 'utf8', cwd: root });
  assert.equal(meta.status, 0, meta.stderr);
  assert.match(meta.stdout, /^package-meta: PASS git$/m);
  const gone = spawnSync(process.execPath, [join(scripts, 'check-package-meta.mjs'), 'no-such-recipe'], { encoding: 'utf8', cwd: root });
  assert.equal(gone.status, 1);
  assert.match(gone.stdout, /^package-meta: FAIL no-such-recipe: no recipe\.yaml$/m);
});

test('callers run the gates through gate.mjs: host-run.sh and kernel-compat.yml', () => {
  const host = readFileSync(join(scripts, 'host-run.sh'), 'utf8');
  for (const line of host.split('\n').filter((l) => /check-(exact-pins|package-meta)\.mjs/.test(l) && !/^\s*#/.test(l))) {
    assert.match(line, /scripts\/gate\.mjs" (exact-pins|package-meta) -- node /, line);
  }
  const kc = readFileSync(join(root, '.github/workflows/kernel-compat.yml'), 'utf8');
  for (const line of kc.split('\n').filter((l) => /compat\.mjs (plan|shard|report)/.test(l))) {
    assert.match(line, /node scripts\/gate\.mjs kernel-compat(-plan|-shard)? -- node scripts\/browser-cert\/compat\.mjs/, line);
  }
  const pp = readFileSync(join(root, '.github/workflows/pool-parity.yml'), 'utf8');
  assert.match(pp, /echo "pool-parity: PASS \$PKG same/);
  assert.match(pp, /echo "pool-parity: FAIL \$PKG differs/);
});

test('the publish-path callers run their gates through gate.mjs: ladder-pr, ladder-build, cert-review', () => {
  const wf = (f) => readFileSync(join(root, '.github/workflows', f), 'utf8');
  const pr = wf('ladder-pr.yml');
  for (const [script, name] of [
    ['check-exact-pins.mjs', 'exact-pins'],
    ['check-cert-kernel.mjs', 'cert-kernel'],
    ['refresh-recipe-sha.mjs "$pkg" --verify-repack', 'recipe-sha'],
    ['host-smoke.sh', 'host-smoke'],
    ['npm-parity.mjs', 'npm-parity'],
    ['browser-cert/run.mjs', 'cert-run'],
    ['browser-cert/cert-leg.mjs plan', 'cert-leg'],
    ['browser-cert/cert-leg.mjs browser-extra', 'cert-leg'],
    ['browser-cert/cert-leg.mjs ci', 'cert-leg'],
  ]) {
    const lines = pr.split('\n').filter((l) => l.includes(script) && !/^\s*#/.test(l) && !l.includes('::error::'));
    assert.ok(lines.length, `ladder-pr.yml runs ${script}`);
    for (const l of lines) assert.match(l, new RegExp(`scripts/gate\\.mjs ${name} -- `), l);
  }
  assert.match(wf('ladder-build.yml'), /node scripts\/gate\.mjs certified-publish -- node scripts\/assert-certified-publish\.mjs/);
  assert.match(wf('ladder-build.yml'), /node scripts\/gate\.mjs verify-published -- node scripts\/verify-published\.mjs/);
  assert.match(wf('cert-review.yml'), /if node scripts\/gate\.mjs cert-verdict -- node scripts\/cert-review\/verdict\.mjs/);
});
