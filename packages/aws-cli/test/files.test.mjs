// Static checks on the built package/ (the test job unpacks the PR's
// tarball over it): what build.sh stages, patches, leaves out and writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'package');
const lib = join(pkg, 'lib', 'aws-cli');
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const recipe = readFileSync(join(here, '..', 'recipe.yaml'), 'utf8');
// The recipe's wheels (build.sh checks them against the source's lock file).
const WHEELS = [...recipe.matchAll(/\/([A-Za-z0-9_.]+)-([0-9][^-/]*)-[^/]*\.whl"/g)].map(([, n, v]) => [n, v]);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

test('the AWS CLI is the recipe release', () => {
  const init = readFileSync(join(lib, 'awscli', '__init__.py'), 'utf8');
  assert.match(init, new RegExp(`^__version__ = '${manifest.homescoop.upstream.replace(/\./g, '\\.')}'$`, 'm'));
  assert.equal(manifest.version.split('-')[0], manifest.homescoop.upstream);
});

test('the patches are applied', () => {
  const compat = readFileSync(join(lib, 'awscli/botocore/compat.py'), 'utf8');
  assert.match(compat, /^    HAS_CRT = os\.environ\.get\('BOTO_DISABLE_CRT'/m, 'awscrt-optional.patch');
  assert.ok(existsSync(join(lib, 'awscli/botocore/crc.py')), 'awscrt-optional.patch: botocore/crc.py');
  for (const f of ['awscli/botocore/utils.py', 'awscli/botocore/credentials.py', 'awscli/botocore/httpchecksum.py', 'awscli/logger.py', 'awscli/customizations/s3/factory.py', 'awscli/customizations/cloudfront/sign.py']) {
    assert.doesNotMatch(readFileSync(join(lib, f), 'utf8'), /^(import awscrt|from awscrt)/m, `${f} imports awscrt at module level`);
  }
  assert.match(readFileSync(join(lib, 'awscli/help.py'), 'utf8'), /writer=TextWriter\(\),\n\s+settings_overrides=self\._DEFAULT_DOCUTILS_SETTINGS_OVERRIDES,\n\s+\)\n\s+LOG\.debug\("Running command/, 'help-text.patch');
  assert.match(readFileSync(join(lib, 'awscli/customizations/sso/utils.py'), 'utf8'), /'name': 'use-device-code',\n\s+'action': 'store_true',\n(?:\s+#.*\n)+\s+'default': True,/, 'sso-device-code.patch');
});

test('no awscrt, bytecode, native code or links; no wheel scripts or RECORDs', () => {
  const bad = [];
  for (const f of walk(join(pkg, 'lib'))) {
    if (/__pycache__|\.(pyc|so|dylib|dll|exe|pyd|orig|rej)$|\.data\/|\.dist-info\/RECORD$|\/\.homescoop-patched-/.test(f)) bad.push(f);
    if (lstatSync(f).isSymbolicLink() || statSync(f).nlink !== 1) bad.push(f);
  }
  assert.deepEqual(bad, []);
  assert.ok(!existsSync(join(lib, 'awscrt')), 'awscrt');
  assert.ok(!existsSync(join(lib, 'ruamel', 'yaml', 'clib')), 'ruamel.yaml.clib');
});

test('each dependency the recipe names is there, with its dist-info', () => {
  assert.equal(WHEELS.length, 10, WHEELS.join(' '));
  for (const [name, version] of WHEELS) {
    assert.ok(existsSync(join(lib, `${name}-${version}.dist-info`, 'METADATA')), `${name} ${version}`);
  }
});

test('the autocomplete index and the upstream launchers are there', () => {
  const index = readFileSync(join(lib, 'awscli/data/ac.index'));
  assert.equal(index.subarray(0, 16).toString('latin1'), 'SQLite format 3\0');
  assert.ok(index.length > 1_000_000, `ac.index is ${index.length} bytes`);
  for (const t of ['aws', 'aws_completer']) assert.match(readFileSync(join(lib, 'bin', t), 'utf8'), /^#!\/usr\/bin\/env python\n/);
});

test('bin/aws and bin/aws_completer are the launcher, executable, and the only commands', () => {
  const launcher = readFileSync(join(here, '..', 'src', 'launcher.py'), 'utf8');
  assert.ok(launcher.startsWith('#!/usr/bin/env -S python3 -S\n'));
  for (const t of ['aws', 'aws_completer']) {
    const p = join(pkg, 'bin', t);
    assert.equal(readFileSync(p, 'utf8'), launcher, `bin/${t}`);
    assert.equal(statSync(p).mode & 0o777, 0o755, `bin/${t} mode`);
    assert.equal(manifest.slicc.commands[t].script, `bin/${t}`);
  }
  assert.deepEqual(Object.keys(manifest.slicc.commands).sort(), ['aws', 'aws_completer']);
});

test('LICENSE is AWS\'s notice and the Apache License 2.0', () => {
  const licence = readFileSync(join(pkg, 'LICENSE'), 'utf8');
  assert.match(licence, /^Copyright Amazon\.com, Inc\. or its affiliates\./);
  assert.match(licence, /END OF TERMS AND CONDITIONS/);
});
