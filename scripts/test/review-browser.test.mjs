import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTIFACT, builtPackages, kernelFor, locator, peerSpecs, SHELL } from '../review-browser.mjs';

const script = fileURLToPath(new URL('../review-browser.mjs', import.meta.url));
const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ladder-build.yml', import.meta.url)), 'utf8');

test('builtPackages: one host-<recipe>-prN directory with a package.tgz per package, cert reports and strays ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-browser-'));
  for (const name of ['host-jq-pr12', 'host-wasix-python3.15-pr12', 'cert-jq-pr12', 'host-empty-pr12', 'stray']) mkdirSync(join(dir, name));
  writeFileSync(join(dir, 'host-jq-pr12', 'package.tgz'), '');
  writeFileSync(join(dir, 'host-wasix-python3.15-pr12', 'package.tgz'), '');
  writeFileSync(join(dir, 'cert-jq-pr12', 'package.tgz'), '');
  assert.deepEqual(
    builtPackages(dir).map(({ recipe, pr }) => ({ recipe, pr })),
    [
      { recipe: 'jq', pr: 12 },
      { recipe: 'wasix-python3.15', pr: 12 },
    ],
  );
  assert.deepEqual(builtPackages(join(dir, 'missing')), []);
  assert.deepEqual(builtPackages(''), []);
  assert.ok(ARTIFACT.test('host-a-pr1') && !ARTIFACT.test('cert-a-pr1'));
});

test('peerSpecs: each needs once, a matching needsInstall pin wins, a built package is never a peer, and a shell is always there', () => {
  const metas = [
    { needs: ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-xz'], needsInstall: ['@ai-ecoverse/wasm-xz@5.8.1-3', 'unrelated@1'] },
    { needs: ['@ai-ecoverse/wasm-xz', '@ai-ecoverse/wasm-jq'] },
  ];
  assert.deepEqual(peerSpecs(metas, ['@ai-ecoverse/wasm-jq']), [
    { name: '@ai-ecoverse/wasm-bash', spec: '@ai-ecoverse/wasm-bash@latest' },
    { name: '@ai-ecoverse/wasm-xz', spec: '@ai-ecoverse/wasm-xz@5.8.1-3' },
    { name: '@ai-ecoverse/wasm-coreutils', spec: '@ai-ecoverse/wasm-coreutils@latest' },
  ]);
  assert.deepEqual(
    peerSpecs([{}], SHELL).map((p) => p.name),
    [],
  );
});

test('kernelFor: the extension browsers boot the cert kernel, the cli browsers npm latest', () => {
  assert.equal(kernelFor('extension').local, 'node_modules/@ai-ecoverse/slicc-kernel');
  assert.equal(kernelFor('cli').spec, '@ai-ecoverse/slicc-kernel@latest');
});

test('locator: the first matching root, index.html for a directory, never a path outside its root', () => {
  const locate = locator([
    ['/dist/', '/k/dist'],
    ['/', '/page'],
  ]);
  assert.equal(locate('/dist/index.js'), '/k/dist/index.js');
  assert.equal(locate('/'), '/page/index.html');
  assert.equal(locate('/dist/../../etc/passwd'), null);
});

test('the hook always exits 0 and reports what it could not do', () => {
  const temp = mkdtempSync(join(tmpdir(), 'review-browser-hook-'));
  const run = (env) => spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH, RUNNER_TEMP: temp, ...env } });
  const bad = run({ SLICC_REVIEW_SIDE: 'left', SLICC_REVIEW_LINK: 'cli', SLICC_REVIEW_CDP: 'http://127.0.0.1:1' });
  assert.equal(bad.status, 0, bad.stderr);
  assert.equal(JSON.parse(readFileSync(join(temp, 'review', 'homescoop', 'left-cli.json'), 'utf8')).state, 'error');
  const none = run({ SLICC_REVIEW_SIDE: 'head', SLICC_REVIEW_LINK: 'extension', SLICC_REVIEW_CDP: 'http://127.0.0.1:1', SLICC_ARTIFACTS: join(temp, 'none') });
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /review-browser: head-extension: none: no host-<recipe>-prN artifact/);
});

test('ladder-build.yml hands the reviewers the tarballs and cert reports, and runs this hook', () => {
  assert.match(workflow, /\n {6}review-browser: node scripts\/review-browser\.mjs\n/);
  assert.match(workflow, /\n {6}artifacts: \$\{\{ github\.event_name == 'pull_request' && format\('@\(host\|cert\)-\*-pr\{0\}', github\.event\.pull_request\.number\) \|\| '' \}\}\n/);
});
