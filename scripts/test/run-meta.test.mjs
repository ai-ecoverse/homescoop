import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(packages) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-run-meta-')));
  cpSync(join(scripts, 'browser-cert'), join(root, 'scripts', 'browser-cert'), { recursive: true });
  cpSync(join(scripts, 'gate.mjs'), join(root, 'scripts', 'gate.mjs'));
  for (const [name, meta] of Object.entries(packages)) {
    mkdirSync(join(root, 'packages', name, 'cert'), { recursive: true });
    if (meta !== undefined) writeFileSync(join(root, 'packages', name, 'cert', 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  const certDir = (files) => {
    const dir = mkdtempSync(join(root, 'reviewer-'));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    return dir;
  };
  const run = (pkg, ...args) => {
    const json = join(root, `${pkg}.json`);
    rmSync(json, { force: true });
    const r = spawnSync(process.execPath, [join(root, 'scripts/browser-cert/run.mjs'), '--package', pkg, '--json', json, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOMESCOOP_CERT_NODE_MODULES: join(root, 'no-node-modules') },
    });
    let report = null;
    try {
      report = JSON.parse(readFileSync(json, 'utf8'));
    } catch {}
    return { ...r, out: `${r.stdout}${r.stderr}`, report };
  };
  return { root, certDir, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

const spec = "export default async ({ run, assert }) => { assert.equal((await run(['bash', '-c', 'true'])).status, 0); };\n";

test('--cert <dir> without a meta.json takes the package\'s cert/meta.json, and says so', () => {
  const f = fixture({ perl: { harness: 'host-node', needs: ['@ai-ecoverse/wasm-bash'] } });
  try {
    const dir = f.certDir({ 'a.mjs': spec });
    const r = f.run('perl', '--cert', dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /browser-cert: meta packages\/perl\/cert\/meta\.json \(reviewer-\w+ has no meta\.json\)/);
    assert.match(r.out, /harness=host-node/);
    assert.equal(r.report.meta, 'packages/perl/cert/meta.json');
    assert.equal(r.report.harness, 'host-node');
    assert.equal(r.report.status, 'skip');
  } finally {
    f.done();
  }
});

test('--cert <dir> with its own meta.json uses that one', () => {
  const f = fixture({ perl: { harness: 'host-node' } });
  try {
    const dir = f.certDir({ 'a.mjs': spec, 'meta.json': JSON.stringify({ harness: 'slicc-realm' }) });
    const r = f.run('perl', '--cert', dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /requires full SLICC realm/);
    assert.doesNotMatch(r.out, /has no meta\.json/);
    assert.equal(r.report.harness, 'slicc-realm');
    assert.match(r.report.meta, /reviewer-\w+\/meta\.json$/);
  } finally {
    f.done();
  }
});

test('the default cert directory reads its own meta.json, with no fallback note', () => {
  const f = fixture({ perl: { harness: 'host-smoke' } });
  try {
    const r = f.run('perl');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /browser-cert: meta packages\/perl\/cert\/meta\.json\n/);
    assert.doesNotMatch(r.out, /has no meta\.json/);
    assert.equal(r.report.harness, 'host-smoke');
  } finally {
    f.done();
  }
});

test('a cert/meta.json that is not a JSON object, or not JSON, fails run.mjs before it boots anything', () => {
  const f = fixture({ list: '[]', word: '"host-node"', nothing: 'null', broken: '{ "harness": ' });
  try {
    for (const [name, why] of [
      ['list', 'is not a JSON object \\(it is an array\\)'],
      ['word', 'is not a JSON object \\(it is a string\\)'],
      ['nothing', 'is not a JSON object \\(it is null\\)'],
      ['broken', 'is not readable JSON: '],
    ]) {
      const r = f.run(name);
      assert.equal(r.status, 1, `${name}: ${r.out}`);
      assert.match(r.out, new RegExp(`browser-cert: packages/${name}/cert/meta\\.json ${why}`));
      assert.doesNotMatch(r.out, /no-node-modules|slicc-shared-web not found/);
      assert.equal(r.report.status, 'fail');
      assert.match(r.report.error, new RegExp(why));
      const fromReviewer = f.run(name, '--cert', f.certDir({ 'a.mjs': spec }));
      assert.equal(fromReviewer.status, 1, `${name} via --cert: ${fromReviewer.out}`);
      assert.match(fromReviewer.out, new RegExp(why));
    }
  } finally {
    f.done();
  }
});
