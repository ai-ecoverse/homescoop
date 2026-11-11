// Static checks on the built package/ (the test job unpacks the PR's
// tarball over it): what build.sh trims, sets and writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package');
const sdk = join(pkg, 'lib', 'google-cloud-sdk');
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const COMPONENTS = ['alpha', 'beta', 'bq', 'core', 'gcloud-deps'];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

test('the SDK release is the recipe version', () => {
  assert.equal(readFileSync(join(sdk, 'VERSION'), 'utf8').trim(), manifest.homescoop.upstream);
  const config = JSON.parse(readFileSync(join(sdk, 'lib/googlecloudsdk/core/config.json'), 'utf8'));
  assert.equal(config.version, manifest.homescoop.upstream);
});

test('no bytecode, no native code, no links, no shell launchers or installers', () => {
  const bad = [];
  for (const f of walk(join(pkg, 'lib'))) {
    if (/__pycache__|\.(pyc|so|dylib|dll|exe|pyd)$/.test(f)) bad.push(f);
    if (!statSync(f).isFile()) bad.push(f);
  }
  assert.deepEqual(bad, []);
  for (const f of ['bin/gcloud', 'bin/bq', 'bin/docker-credential-gcloud', 'bin/git-credential-gcloud.sh', 'install.sh', 'install.bat', 'completion.bash.inc', 'path.bash.inc', 'RELEASE_NOTES', 'deb', 'rpm', 'platform/bundledpythonunix', 'platform/gsutil', 'bin/gcloud-crc32c']) {
    assert.ok(!existsSync(join(sdk, f)), `${f} is staged`);
  }
});

test('the component manager is off, and update checks, usage reporting and survey prompts with it', () => {
  const config = JSON.parse(readFileSync(join(sdk, 'lib/googlecloudsdk/core/config.json'), 'utf8'));
  assert.equal(config.disable_updater, true);
  assert.equal(config.disable_usage_reporting, true);
  assert.equal(readFileSync(join(sdk, 'properties'), 'utf8'),
    '[component_manager]\ndisable_update_check = True\n\n[core]\ndisable_usage_reporting = True\n\n[survey]\ndisable_prompts = True\n');
});

test('.install/ has a snapshot and a manifest for each component, listing only shipped files', () => {
  const state = join(sdk, '.install');
  assert.deepEqual(readdirSync(state).sort(), COMPONENTS.flatMap((c) => [`${c}.manifest`, `${c}.snapshot.json`]).sort());
  for (const c of COMPONENTS) {
    const snap = JSON.parse(readFileSync(join(state, `${c}.snapshot.json`), 'utf8'));
    assert.equal(snap.version, manifest.homescoop.upstream, `${c}.snapshot.json`);
    assert.deepEqual(snap.components.map((x) => x.id), [c]);
    const files = readFileSync(join(state, `${c}.manifest`), 'utf8').split('\n').filter(Boolean);
    for (const f of files) {
      if (f.endsWith('/')) continue;
      assert.ok(existsSync(join(sdk, f)), `${c}.manifest lists ${f}, which isn't shipped`);
    }
    if (c === 'core') assert.ok(files.includes('lib/gcloud.py') && !files.includes('bin/gcloud') && !files.includes('RELEASE_NOTES'));
    if (c === 'bq') assert.ok(files.includes('platform/bq/bq.py'));
  }
});

test('bin/gcloud and bin/bq are the launcher, executable, and the only commands', () => {
  const launcher = readFileSync(join(pkg, '..', 'src', 'launcher.py'), 'utf8');
  for (const t of ['gcloud', 'bq']) {
    const p = join(pkg, 'bin', t);
    assert.equal(readFileSync(p, 'utf8'), launcher, `bin/${t}`);
    assert.equal(statSync(p).mode & 0o777, 0o755, `bin/${t} mode`);
    assert.equal(manifest.slicc.commands[t].script, `bin/${t}`);
  }
  assert.deepEqual(Object.keys(manifest.slicc.commands).sort(), ['bq', 'gcloud']);
  assert.ok(launcher.startsWith('#!/usr/bin/env python3\n'));
});
