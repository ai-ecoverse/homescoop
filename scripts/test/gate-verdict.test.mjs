import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_VERDICT, decide, verdictIn } from '../gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gate = join(root, 'scripts', 'gate.mjs');
const node = process.execPath;

const GATES = {
  'check-exact-pins': 'scripts/check-exact-pins.mjs',
  'check-cert-kernel': 'scripts/check-cert-kernel.mjs',
  'cert-kernel': 'scripts/browser-cert/cert-kernel.mjs',
  'dev-pin': 'scripts/dev-pin.mjs',
  compat: 'scripts/browser-cert/compat.mjs',
  'repack-input': 'scripts/cert-review/repack-input.mjs',
  'ladder-merge-resolve': 'scripts/ladder-merge-resolve.mjs',
  publish: 'scripts/npm-publish.mjs',
  'npm-parity': 'scripts/npm-parity.mjs',
  'package-meta': 'scripts/check-package-meta.mjs',
  'cert-leg': 'scripts/browser-cert/cert-leg.mjs',
  'certified-publish': 'scripts/assert-certified-publish.mjs',
  'cert-verdict': 'scripts/cert-review/verdict.mjs',
  'issue-dedupe': 'scripts/cert-review/issue-dedupe.mjs',
  'threaded-heap': 'scripts/check-threaded-heap.mjs',
};
if (existsSync(join(root, 'scripts/check-no-debug.mjs'))) GATES['check-no-debug'] = 'scripts/check-no-debug.mjs';

function child(t, body) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-verdict-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'child.mjs');
  writeFileSync(file, body);
  return file;
}
const wrap = (name, ...cmd) => spawnSync(node, [gate, name, '--', ...cmd], { encoding: 'utf8' });

test('verdictIn and decide: silence, PASS, FAIL and a non-zero exit', () => {
  assert.equal(verdictIn('dev-pin', 'x\ndev-pin: PASS a@1\n'), 'PASS');
  assert.equal(verdictIn('dev-pin', '::error::dev-pin: FAIL nope'), 'FAIL');
  assert.equal(verdictIn('dev-pin', 'dev-pin: PASSED'), null);
  assert.equal(verdictIn('dev-pin', 'not dev-pin: PASS'), null);
  assert.equal(verdictIn('compat report', 'compat report: PASS 3 rows'), 'PASS');
  assert.deepEqual(decide('g', 0, 'PASS'), { code: 0, note: null });
  assert.equal(decide('g', 0, null).code, NO_VERDICT);
  assert.equal(decide('g', 0, 'FAIL').code, 1);
  assert.equal(decide('g', 4, null).code, 4);
  assert.equal(decide('g', 1, 'FAIL').note, null);
});

test('NEGATIVE: a gate that exits 0 with no verdict line fails its caller (an early exit, a skipped CLI guard, #968)', (t) => {
  const silent = wrap('check-exact-pins', node, child(t, 'process.exit(0);\n'));
  assert.equal(silent.status, NO_VERDICT);
  assert.match(silent.stderr, /check-exact-pins: exited 0 without a "check-exact-pins: PASS" line; a gate's silence is not a pass/);
  const chatty = wrap('check-exact-pins', node, child(t, "console.log('check-exact-pins: 3 package.json ok');\n"));
  assert.equal(chatty.status, NO_VERDICT, 'the old success line is not a verdict');
  const other = wrap('check-exact-pins', node, child(t, "console.log('dev-pin: PASS x@1');\n"));
  assert.equal(other.status, NO_VERDICT, "another gate's verdict does not count");
});

test('a PASS passes stdout through unchanged (command substitution keeps working); FAIL or a non-zero exit fails', (t) => {
  const ok = wrap('dev-pin', node, child(t, "console.log('playwright-core@1.2.3');\nconsole.error('dev-pin: PASS playwright-core@1.2.3');\n"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'playwright-core@1.2.3\n');
  const failed = wrap('dev-pin', node, child(t, "console.error('dev-pin: FAIL no pin');\n"));
  assert.equal(failed.status, 1);
  const crashed = wrap('dev-pin', node, child(t, "process.exit(5);\n"));
  assert.equal(crashed.status, 5);
  assert.match(crashed.stderr, /dev-pin: exited 5 with no "dev-pin: FAIL" line/);
  const late = wrap('dev-pin', node, child(t, "process.stdout.write('dev-pin: PA');\nsetTimeout(() => process.stdout.write('SS split\\n'), 20);\n"));
  assert.equal(late.status, 0, 'a verdict line split across writes still counts');
});

test('every gate prints its PASS line: dev-pin, cert-kernel, check-exact-pins and repack-input, run for real', () => {
  const pin = wrap('dev-pin', node, join(root, 'scripts/dev-pin.mjs'), 'playwright-core');
  assert.equal(pin.status, 0, pin.stderr);
  assert.match(pin.stdout, /^playwright-core@\d[^\n]*\n$/);
  const pkg = readdirSync(join(root, 'packages')).find((p) => {
    try {
      readFileSync(join(root, 'packages', p, 'package', 'package.json'));
      return true;
    } catch {
      return false;
    }
  });
  const kernel = wrap('cert-kernel', node, join(root, 'scripts/browser-cert/cert-kernel.mjs'), pkg);
  assert.equal(kernel.status, 0, kernel.stderr);
  assert.match(kernel.stdout, /^@ai-ecoverse\/slicc-kernel@\d/);
  const pins = wrap('check-exact-pins', node, join(root, 'scripts/check-exact-pins.mjs'), pkg);
  assert.equal(pins.status, 0, pins.stdout + pins.stderr);
  assert.match(pins.stdout, /check-exact-pins: PASS 1 package\.json/);
  const fixtures = join(root, 'scripts/test/fixtures/repack-input');
  const attested = wrap('repack-input', node, join(root, 'scripts/cert-review/repack-input.mjs'), '--fixtures', join(fixtures, 'attested'), '--package', 'pkgconf');
  assert.equal(attested.status, 0, attested.stderr);
  assert.match(attested.stderr, /repack-input: PASS pkgconf: attested/);
  const planted = wrap('repack-input', node, join(root, 'scripts/cert-review/repack-input.mjs'), '--fixtures', join(fixtures, 'planted'), '--package', 'planted');
  assert.equal(planted.status, 1);
  assert.match(planted.stderr, /repack-input: FAIL planted: unverifiable/);
});

test('every gate script prints "<gate>: PASS", and every caller in the workflows, host-run and harness.sh goes through gate.mjs', () => {
  for (const [name, file] of Object.entries(GATES)) {
    const text = readFileSync(join(root, file), 'utf8');
    const want = name === 'compat' ? /`compat \$\{args\._\[0\]\}: PASS/ : new RegExp(`${name}: PASS`);
    assert.match(text, want, `${file} prints no "${name}: PASS" line`);
  }
  const callers = [
    ...readdirSync(join(root, '.github/workflows')).filter((f) => f.endsWith('.yml')).map((f) => join('.github/workflows', f)),
    'scripts/host-run.sh',
    'scripts/cert-review/harness.sh',
  ];
  const bad = [];
  for (const rel of callers) {
    for (const [i, line] of readFileSync(join(root, rel), 'utf8').split('\n').entries()) {
      for (const file of Object.values(GATES)) {
        const base = file.replace(/^scripts\//, '');
        const call = new RegExp(`node\\s+("?\\$[A-Z_]+/)?"?scripts/${base.replace(/[.]/g, '\\.')}`);
        if (!call.test(line)) continue;
        if (/gate\.mjs|gated |"\$\{gate\[@\]\}"/.test(line)) continue;
        if (/^\s*#|^\s*-\s*'scripts\//.test(line) || /pr-review\.yml$/.test(rel)) continue;
        bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'run gates as: node scripts/gate.mjs <gate> -- node scripts/<gate>.mjs …');
});

function compatReport(t, { skipped = [], sweepRows = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-compat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const kernel = { name: '@ai-ecoverse/slicc-kernel', version: '1.0.0', spec: '@ai-ecoverse/slicc-kernel@1.0.0', sha256: 'a'.repeat(64) };
  const plan = {
    kernel,
    reference: { ...kernel, version: '0.9.0', origin: 'input' },
    inputs: { set: 'base', biosRef: 'main', reference: '' },
    biosRef: 'main',
    homescoopRef: 'main',
    entries: [],
    skipped,
    shards: sweepRows ? [{ units: [], sweeps: ['enforce'], estimateS: 1 }] : [],
    ...(sweepRows ? { sweep: { modes: ['enforce'] } } : {}),
  };
  mkdirSync(join(dir, 'plan'));
  mkdirSync(join(dir, 'results'));
  writeFileSync(join(dir, 'plan', 'plan.json'), JSON.stringify(plan));
  if (sweepRows) writeFileSync(join(dir, 'results', 'sweep-enforce.json'), JSON.stringify({ mode: 'enforce', wallMs: 1000, rows: sweepRows }));
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(node, [gate, 'compat report', '--', node, join(root, 'scripts/browser-cert/compat.mjs'), 'report', '--plan', join(dir, 'plan', 'plan.json'), '--results', join(dir, 'results'), '--out', join(dir, 'out')], { encoding: 'utf8', env });
}

test('NEGATIVE: a kernel-compat report where nothing ran fails; one with only base-sweep rows passes', (t) => {
  const none = compatReport(t, { skipped: [{ package: '@ai-ecoverse/wasm-x', recipe: 'x', version: '1.0.0-1', origin: ['base'], reason: 'no recipe' }] });
  assert.equal(none.status, 1, none.stdout + none.stderr);
  assert.match(none.stdout, /compat report: FAIL 0 rows/);
  const sweep = compatReport(t, { sweepRows: [{ case: 'ls', verdict: 'pass' }, { case: 'cat', verdict: 'pass' }] });
  assert.equal(sweep.status, 0, sweep.stdout + sweep.stderr);
  assert.match(sweep.stdout, /compat report: PASS 2 rows, 0 regression\(s\), verdict pass/);
});

test('run.mjs (cert-run) and refresh-recipe-sha (recipe-sha) print their verdicts, and their gate calls go through gate.mjs', () => {
  assert.match(readFileSync(join(root, 'scripts/browser-cert/run.mjs'), 'utf8'), /cert-run: PASS/);
  assert.match(readFileSync(join(root, 'scripts/refresh-recipe-sha.mjs'), 'utf8'), /recipe-sha: PASS/);
  const pr = readFileSync(join(root, '.github/workflows/ladder-pr.yml'), 'utf8');
  // recipe-sha runs the PR head's script (its job checks out the head to push): it is wrapped
  // whenever that script prints the verdict, and only a pre-#1019 branch runs it unwrapped, with a warning.
  assert.match(pr, /grep -q 'recipe-sha: PASS' scripts\/refresh-recipe-sha\.mjs; then\n\s*gate=\(node scripts\/gate\.mjs recipe-sha --\)/);
  assert.match(pr, /\$\{gate\[@\]\+"\$\{gate\[@\]\}"\} node scripts\/refresh-recipe-sha\.mjs "\$pkg" --verify-repack/);
  assert.match(pr, /::warning::recipe-sha: this branch's refresh-recipe-sha\.mjs predates the verdict line/);
  assert.match(pr, /node scripts\/gate\.mjs cert-run -- node scripts\/browser-cert\/run\.mjs/);
  assert.match(pr, /node scripts\/gate\.mjs host-smoke -- bash scripts\/host-smoke\.sh/);
  assert.match(readFileSync(join(root, '.github/workflows/kernel-compat-proof.yml'), 'utf8'), /node scripts\/gate\.mjs cert-run -- node scripts\/browser-cert\/run\.mjs/);
  assert.match(readFileSync(join(root, 'scripts/browser-cert/cert-leg.mjs'), 'utf8'), /'scripts\/gate\.mjs'\), 'cert-run', '--'/);
});

test('host-smoke.sh says PASS, even when there is no smoke.c to run', () => {
  const r = spawnSync(node, [gate, 'host-smoke', '--', 'bash', join(root, 'scripts/host-smoke.sh'), 'no-such-recipe'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^host-smoke: PASS no-such-recipe has no smoke\.c$/m);
});
