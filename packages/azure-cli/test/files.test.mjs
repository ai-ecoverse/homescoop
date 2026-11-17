// Static checks on the built package/ (the test job unpacks the PR's
// tarball over it): what build.sh installs, leaves out, patches and writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const recipeDir = join(here, '..');
const pkg = join(recipeDir, 'package');
const site = join(pkg, 'lib', 'azure-cli');
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const canon = (n) => n.replace(/[-_.]+/g, '-').toLowerCase();

const lockText = readFileSync(join(recipeDir, 'wheels.lock'), 'utf8');
const lock = lockText.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const [name, version, pin, kind, sha256, url] = l.split(' ');
  return { name, version, pin, kind, sha256, url };
});
const excluded = [...lockText.matchAll(/^# excluded (\S+) (\S+): (.+)$/gm)].map((m) => m[1]);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function distInfos() {
  const out = new Map();
  for (const d of readdirSync(site).filter((x) => x.endsWith('.dist-info'))) {
    const meta = readFileSync(join(site, d, 'METADATA'), 'utf8');
    out.set(canon(meta.match(/^Name: (.+)$/m)[1].trim()), { dir: d, version: meta.match(/^Version: (.+)$/m)[1].trim() });
  }
  return out;
}

test('the lock is for the recipe release and installs exactly its distributions', () => {
  assert.match(lockText, new RegExp(`^# azure-cli ${manifest.homescoop.upstream.replace(/\./g, '\\.')}$`, 'm'));
  const recipe = readFileSync(join(recipeDir, 'recipe.yaml'), 'utf8');
  assert.equal(lockText.match(/^# requirements (\S+) /m)[1], recipe.match(/^source:\n(?:  #.*\n)*  url: .*\n  sha256: "([0-9a-f]{64})"/m)[1]);
  const dists = distInfos();
  assert.deepEqual([...dists.keys()].sort(), lock.map((e) => e.name).sort());
  for (const e of lock) assert.equal(dists.get(e.name).version, e.version, e.name);
  for (const e of lock) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.ok(e.url.startsWith('https://files.pythonhosted.org/packages/'), e.url);
    assert.ok(e.kind === 'wheel' ? e.url.endsWith('-none-any.whl') : e.kind === 'sdist:lib/yaml' && e.name === 'pyyaml', `${e.name}: ${e.kind} ${e.url}`);
  }
});

test('the native packages and what needs them at import are left out', () => {
  assert.deepEqual(excluded.sort(), ['bcrypt', 'cffi', 'cryptography', 'fabric', 'paramiko', 'psutil', 'pynacl', 'pyopenssl', 'scp', 'sshtunnel']);
  const dists = distInfos();
  for (const n of [...excluded, 'pycparser']) assert.ok(!dists.has(n), `${n} is installed`);
  for (const d of ['cryptography', 'OpenSSL', 'nacl', 'bcrypt', 'psutil', 'paramiko', 'fabric', 'scp.py', 'sshtunnel.py', '_cffi_backend']) {
    assert.ok(!existsSync(join(site, d)), `${d} is staged`);
  }
});

test('no bytecode, no native code, no links, no wheel scripts', () => {
  const bad = [];
  for (const f of walk(join(pkg, 'lib'))) {
    if (/__pycache__|\.(pyc|pyo|so|dylib|dll|exe|pyd|orig|rej)$/.test(f)) bad.push(f);
    if (!statSync(f).isFile()) bad.push(f);
  }
  assert.deepEqual(bad, []);
  assert.ok(!readdirSync(site).some((d) => d.endsWith('.data')), 'no <dist>.data directories');
  assert.ok(!existsSync(join(pkg, 'bin', 'az.completion.sh')) && !existsSync(join(site, 'bin')));
});

test("upstream's packaged command index ships, and trim_sdk.py's trim is applied", () => {
  for (const f of ['commandIndex.latest.json', 'helpIndex.latest.json']) {
    const index = JSON.parse(readFileSync(join(site, 'azure/cli/core', f), 'utf8'));
    assert.equal(index.version, manifest.homescoop.upstream, f);
    assert.equal(index.cloudProfile, 'latest', f);
  }
  // trim_sdk.py drops the mgmt SDKs' aio/ trees.
  const aio = [...walk(join(site, 'azure/mgmt'))].filter((f) => f.includes('/aio/'));
  assert.deepEqual(aio.slice(0, 3), []);
});

test('can-launch-browser-wasi.patch is applied to azure-cli-core', () => {
  const util = readFileSync(join(site, 'azure/cli/core/util.py'), 'utf8');
  assert.match(util, /^ {4}if platform_name not in \('linux', 'wasi'\):$/m);
  assert.doesNotMatch(util, /^ {4}if platform_name != 'linux':$/m);
});

test('storage-encryption-without-cryptography.patch is applied to the storage SDKs', () => {
  for (const f of ['azure/storage/blob/_encryption.py', 'azure/storage/queue/_encryption.py', 'azure/storage/common/_encryption.py']) {
    const src = readFileSync(join(site, f), 'utf8');
    assert.match(src, /^try:\n {4}from cryptography\.hazmat\.backends import default_backend$/m, f);
    assert.match(src, /^except ImportError: {2}# homescoop#2112: no cryptography on wasix-python$/m, f);
    assert.doesNotMatch(src, /^from cryptography/m, f);
  }
});

test('bin/az is src/launcher.py, mode 0755, and the only command', () => {
  const launcher = readFileSync(join(recipeDir, 'src', 'launcher.py'), 'utf8');
  const az = join(pkg, 'bin', 'az');
  assert.equal(readFileSync(az, 'utf8'), launcher);
  assert.equal(statSync(az).mode & 0o777, 0o755);
  assert.deepEqual(manifest.slicc.commands, { az: { script: 'bin/az' } });
  assert.ok(launcher.startsWith('#!/usr/bin/env python3\n'));
  assert.deepEqual(readdirSync(join(pkg, 'bin')), ['az']);
});

test('LICENSE is azure-cli\'s, and the notices list every distribution', () => {
  const license = readFileSync(join(pkg, 'LICENSE'), 'utf8');
  assert.equal(license, readFileSync(join(site, `azure_cli-${manifest.homescoop.upstream}.dist-info/licenses/LICENSE.txt`), 'utf8'));
  assert.match(license, /MIT License/);
  const notices = readFileSync(join(pkg, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  const rows = [...notices.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].slice(2);
  const dists = distInfos();
  assert.deepEqual(rows.map((r) => canon(r[1].trim())).sort(), [...dists.keys()].sort());
  for (const r of rows) {
    for (const f of r[4].matchAll(/`lib\/azure-cli\/([^`]+)`/g)) assert.ok(existsSync(join(site, f[1])), `${r[1]}: ${f[1]}`);
  }
  // A distribution whose wheel ships no license file has a section with the
  // text licenses.map names, and licenses.map names no other.
  const map = readFileSync(join(recipeDir, 'licenses.map'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' '));
  assert.deepEqual(rows.filter((r) => r[4].trim() === 'below').map((r) => canon(r[1].trim())).sort(), map.map((m) => m[0]).sort());
  for (const [name, version, spdx] of map) {
    assert.equal(version, lock.find((e) => e.name === name).version, `licenses.map ${name}`);
    const sec = notices.split(/^## /m).find((x) => x.startsWith(`${name} ${version} (${spdx})\n`));
    assert.ok(sec, `no notices section for ${name}`);
    assert.match(sec, new RegExp(`^License: ${spdx}$`, 'm'));
    assert.match(sec, spdx === 'MIT' ? /Permission is hereby granted, free of charge/ : /Redistribution and use in source and binary forms[\s\S]*Neither (the )?name of/, name);
  }
  const yaml = lock.find((e) => e.name === 'pyyaml');
  assert.ok(existsSync(join(site, `pyyaml-${yaml.version}.dist-info/licenses/LICENSE`)), "PyYAML's LICENSE from its sdist");
});
