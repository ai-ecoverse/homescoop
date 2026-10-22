import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const workflow = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows', 'ladder-build.yml');
const text = readFileSync(workflow, 'utf8');
const lines = text.split('\n');
const indentOf = (l) => l.length - l.trimStart().length;
const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');

function block(from, parentIndent) {
  const out = [];
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      out.push('');
      continue;
    }
    if (indentOf(lines[i]) <= parentIndent) break;
    out.push(lines[i]);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function mapOf(blk) {
  const ind = Math.min(...blk.filter(Boolean).map(indentOf));
  const map = {};
  for (const l of blk) {
    if (!l || indentOf(l) !== ind) continue;
    const m = l.trim().match(/^([\w-]+):\s*(.*)$/);
    if (m) map[m[1]] = unquote(m[2]);
  }
  return map;
}

function dispatchInput(name) {
  const at = lines.findIndex((l) => l.trim() === `${name}:` && indentOf(l) === 6);
  if (at < 0) return null;
  return mapOf(block(at + 1, 6));
}

function publishStep() {
  const at = lines.findIndex((l) => /^\s*- name: Publish via OIDC\s*$/.test(l));
  assert.ok(at >= 0, 'ladder-build.yml has a "Publish via OIDC" step');
  const keyIndent = indentOf(lines[at]) + 2;
  const body = block(at + 1, keyIndent - 2);
  const key = (k) => body.findIndex((l) => indentOf(l) === keyIndent && l.trim().startsWith(`${k}:`));
  const envAt = key('env');
  const runAt = key('run');
  assert.ok(envAt >= 0 && runAt >= 0, 'the publish step has env and run');
  assert.match(body[runAt].trim(), /^run:\s*\|$/);
  const env = mapOf(block(at + 2 + envAt, keyIndent));
  const run = block(at + 2 + runAt, keyIndent);
  const ri = Math.min(...run.filter(Boolean).map(indentOf));
  return { env, run: run.map((l) => l.slice(ri)).join('\n') + '\n' };
}

function stepEnv(stepEnvMap, input) {
  const env = {};
  for (const [k, v] of Object.entries(stepEnvMap)) {
    env[k] = v
      .replace(/\$\{\{\s*inputs\.npm_loglevel\s*\}\}/g, input)
      .replace(/\$\{\{\s*inputs\.certified\s*\}\}/g, 'c'.repeat(64))
      .replace(/\$\{\{\s*needs\.resolve\.outputs\.npm\s*\}\}/g, '@ai-ecoverse/wasm-x')
      .replace(/\$\{\{\s*needs\.resolve\.outputs\.npm_tag\s*\}\}/g, 'latest');
  }
  return env;
}

function runStep(t, input, { declared = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ladder-build-loglevel-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(dir, 'package.tgz'), 'x');
  const dump = join(dir, 'env.json');
  writeFileSync(
    join(bin, 'node'),
    `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v26.0.0; exit 0; fi\nexec "${process.execPath}" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.env))' "${dump}"\n`,
  );
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho 11.0.0\n');
  chmodSync(join(bin, 'node'), 0o755);
  chmodSync(join(bin, 'npm'), 0o755);
  const { env: stepMap, run } = publishStep();
  const script = run.replace(/\$\{\{\s*runner\.temp\s*\}\}/g, dir);
  assert.doesNotMatch(script, /\$\{\{/, 'the run block interpolates no expression the test does not know');
  const base = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc' };
  const env = { ...base, ...stepEnv(stepMap, input) };
  if (!declared) for (const [k, v] of Object.entries(stepMap)) if (/inputs\.npm_loglevel/.test(v)) delete env[k];
  const r = spawnSync('bash', ['-c', script], { env, cwd: dir, encoding: 'utf8' });
  const seen = existsSync(dump) ? JSON.parse(readFileSync(dump, 'utf8')) : null;
  if (seen) {
    for (const k of ['PWD', 'SHLVL', '_', 'OLDPWD']) delete seen[k];
    for (const [k, v] of Object.entries(seen)) seen[k] = v.split(dir).join('<tmp>');
  }
  return { ...r, seen };
}

test('ladder-build declares an optional npm_loglevel dispatch input, empty by default', () => {
  const input = dispatchInput('npm_loglevel');
  assert.ok(input, 'workflow_dispatch has an npm_loglevel input');
  assert.equal(input.type, 'string');
  assert.equal(input.required, 'false');
  assert.equal(input.default, '');
});

test('the publish step reads the input only through its env, never interpolated into the shell', () => {
  const { env, run } = publishStep();
  assert.ok(Object.values(env).some((v) => /\$\{\{\s*inputs\.npm_loglevel\s*\}\}/.test(v)), 'the input reaches the step env');
  assert.doesNotMatch(run, /inputs\.npm_loglevel/);
});

for (const [input, want] of [
  ['http', { NPM_CONFIG_LOGLEVEL: 'http' }],
  ['verbose', { NPM_CONFIG_LOGLEVEL: 'verbose' }],
  ['timing', { NPM_CONFIG_LOGLEVEL: 'http', NPM_CONFIG_TIMING: 'true' }],
]) {
  test(`npm_loglevel=${input} reaches npm-publish as ${JSON.stringify(want)}`, (t) => {
    const r = runStep(t, input);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.seen, 'npm-publish ran');
    const npmKeys = Object.fromEntries(Object.entries(r.seen).filter(([k]) => /^NPM_CONFIG_(LOGLEVEL|TIMING)$/i.test(k)));
    assert.deepEqual(npmKeys, want);
    assert.ok(!Object.keys(r.seen).some((k) => /LOGLEVEL/i.test(k) && !/^NPM_CONFIG_LOGLEVEL$/.test(k)), 'the raw input variable does not reach npm');
  });
}

test('an empty npm_loglevel leaves the publish env exactly as without the input', (t) => {
  const empty = runStep(t, '');
  const without = runStep(t, '', { declared: false });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(without.status, 0, without.stderr);
  assert.ok(empty.seen && without.seen, 'npm-publish ran');
  assert.ok(!Object.keys(empty.seen).some((k) => /^NPM_CONFIG_(LOGLEVEL|TIMING)$/i.test(k) || /NPM_LOGLEVEL/.test(k)));
  const norm = (e) => JSON.stringify(Object.entries(e).sort(([a], [b]) => a.localeCompare(b)));
  assert.equal(norm(empty.seen), norm(without.seen));
});

for (const bad of ['silly', 'HTTP', 'http ', 'timing;id', '$(touch pwned)', 'http\nverbose', 'info']) {
  test(`npm_loglevel=${JSON.stringify(bad)} fails the step before npm-publish runs`, (t) => {
    const r = runStep(t, bad);
    assert.notEqual(r.status, 0);
    assert.equal(r.seen, null, 'npm-publish never ran');
    assert.match(r.stderr, /npm_loglevel must be empty, http, timing or verbose/);
  });
}
