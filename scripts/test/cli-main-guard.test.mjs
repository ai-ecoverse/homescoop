import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = 'process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))';

function scripts(dir = join(root, 'scripts')) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && e.name !== 'test' && e.name !== 'node_modules') out.push(...scripts(p));
    else if (e.isFile() && e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

function linked(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cli-main-guard-'));
  try {
    const link = join(dir, 'hs');
    symlinkSync(root, link, 'dir');
    return fn(link);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('every CLI guard compares real paths, so a symlinked checkout still runs the CLI (homescoop#968)', () => {
  const bad = [];
  for (const p of scripts()) {
    for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) {
      if (line.includes('process.argv[1]') && !line.includes(GUARD)) bad.push(`${relative(root, p)}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], `decide "run as a script" with: ${GUARD}`);
});

test('gates run through a symlinked checkout instead of exiting 0 silently (cloud-run runners, homescoop#968)', () => {
  linked((link) => {
    const run = (script, ...args) => spawnSync(process.execPath, [join(link, 'scripts', script), ...args], { encoding: 'utf8', cwd: tmpdir() });
    const pins = run('check-exact-pins.mjs', 'no-such-package-968');
    assert.equal(pins.status, 1, pins.stdout + pins.stderr);
    assert.match(pins.stderr, /check-exact-pins: pin every @ai-ecoverse/);
    for (const script of ['dev-pin.mjs', 'browser-cert/cert-kernel.mjs', 'peer-tarball.mjs']) {
      const r = run(script);
      assert.equal(r.status, 2, `${script}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /usage:/, script);
    }
    const pin = run('dev-pin.mjs', 'playwright-core');
    assert.equal(pin.status, 0, pin.stderr);
    assert.match(pin.stdout, /^playwright-core@\d/);
  });
});
