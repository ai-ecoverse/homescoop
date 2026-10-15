import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(packages) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-cert-leg-'));
  mkdirSync(join(root, 'scripts', 'browser-cert'), { recursive: true });
  copyFileSync(join(scripts, 'browser-cert', 'cert-leg.mjs'), join(root, 'scripts', 'browser-cert', 'cert-leg.mjs'));
  for (const [name, { meta, specs = [], manifest = {} }] of Object.entries(packages)) {
    const dir = join(root, 'packages', name);
    mkdirSync(join(dir, 'package'), { recursive: true });
    writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: `@ai-ecoverse/${name}`, ...manifest }));
    if (meta || specs.length) mkdirSync(join(dir, 'cert'), { recursive: true });
    if (meta) writeFileSync(join(dir, 'cert', 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
    for (const s of specs) writeFileSync(join(dir, 'cert', s), 'export default async () => {};\n');
  }
  const summary = join(root, 'summary.md');
  const leg = (mode, name) =>
    spawnSync(
      process.execPath,
      [join(root, 'scripts/browser-cert/cert-leg.mjs'), mode, name, ...(mode === 'plan' ? ['--manifest', join(root, 'packages', name, 'package', 'package.json')] : [])],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } },
    );
  const read = () => (existsSync(summary) ? readFileSync(summary, 'utf8') : '');
  return { root, leg, summary: read, done: () => rmSync(root, { recursive: true, force: true }) };
}

const cli = { slicc: { abi: 'emscripten', commands: { x: { glue: 'bin/x', wasm: 'bin/x.wasm' } } } };
const wasi = { slicc: { abi: 'wasi', commands: { x: { wasm: 'bin/x.wasm' } } } };

test('host-node or host-smoke with no ci: commands fails the cert leg', () => {
  const f = fixture({
    openssh: { meta: { harness: 'host-node' }, specs: ['run.mjs', 'checklist.mjs'] },
    sysroot: { meta: { harness: 'host-node', ci: [] } },
    smoke: { meta: { harness: 'host-smoke' } },
  });
  try {
    for (const [name, harness] of [['openssh', 'host-node'], ['sysroot', 'host-node'], ['smoke', 'host-smoke']]) {
      const r = f.leg('plan', name);
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, new RegExp(`::error::${name}: cert harness ${harness} declares no ci commands; nothing was certified`));
      assert.doesNotMatch(r.stdout, /browser=/);
    }
    assert.match(f.summary(), /openssh: cert harness host-node declares no ci commands; nothing was certified/);
  } finally {
    f.done();
  }
});

test('host-node with ci: commands runs them, and a failing one fails the leg', () => {
  const f = fixture({
    ok: { meta: { harness: 'host-node', ci: ['node -e "require(\'fs\').writeFileSync(\'ran-1\', \'1\')"', 'touch ran-2'] } },
    bad: { meta: { harness: 'host-node', ci: ['touch ran-3', 'exit 3', 'touch ran-4'] } },
  });
  try {
    const p = f.leg('plan', 'ok');
    assert.equal(p.status, 0, p.stderr);
    assert.equal(p.stdout.trim(), 'browser=skip');
    assert.doesNotMatch(p.stderr, /::warning::|::error::/);
    const r = f.leg('ci', 'ok');
    assert.equal(r.status, 0, r.stdout);
    assert.ok(existsSync(join(f.root, 'ran-1')) && existsSync(join(f.root, 'ran-2')));
    assert.equal(f.leg('plan', 'bad').status, 0);
    const b = f.leg('ci', 'bad');
    assert.equal(b.status, 3);
    assert.match(b.stdout, /::error::bad: host cert command failed \(3\): exit 3/);
    assert.ok(existsSync(join(f.root, 'ran-3')));
    assert.ok(!existsSync(join(f.root, 'ran-4')));
  } finally {
    f.done();
  }
});

test('a leg that runs nothing passes with a warning and a summary line', () => {
  const f = fixture({
    zlib: {},
    tool: { manifest: wasi },
    held: { meta: { blocked: 'needs an unpublished kernel', harness: 'host-node' }, specs: ['a.mjs'] },
  });
  try {
    for (const [name, browser, why] of [
      ['zlib', 'skip', 'no cert specs; this cert leg certifies nothing'],
      ['tool', 'skip', 'no cert specs; this cert leg certifies nothing'],
      ['held', 'blocked', 'cert/meta.json is blocked and declares no ci commands; this cert leg certifies nothing'],
    ]) {
      const r = f.leg('plan', name);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), `browser=${browser}`);
      assert.ok(r.stderr.includes(`::warning::${name}: ${why}`), r.stderr);
      assert.ok(f.summary().includes(`${name}: ${why}`));
      assert.equal(f.leg('ci', name).status, 0);
    }
  } finally {
    f.done();
  }
});

test('specs or an Emscripten CLI run the browser cert, with no warning', () => {
  const f = fixture({
    jq: { specs: ['basic.mjs'], manifest: cli },
    gh: { meta: { harness: 'slicc-kernel' }, specs: ['checklist.mjs'], manifest: wasi },
    gmake: { manifest: cli },
    heif: { meta: { harness: 'slicc-kernel', ci: ['true'] }, specs: ['checklist.mjs'], manifest: cli },
  });
  try {
    for (const name of ['jq', 'gh', 'gmake', 'heif']) {
      const r = f.leg('plan', name);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'browser=run', name);
      assert.doesNotMatch(r.stderr, /::warning::|::error::/);
    }
    assert.equal(f.summary(), '');
  } finally {
    f.done();
  }
});

test('a cert/meta.json that is not JSON fails the leg, in plan and in ci', () => {
  const f = fixture({ broken: { meta: '{ "harness": "host-node", "ci": ["true"], }' }, empty: { meta: ' ' } });
  try {
    for (const name of ['broken', 'empty']) {
      const p = f.leg('plan', name);
      assert.equal(p.status, 1, name);
      assert.match(p.stderr, new RegExp(`::error::packages/${name}/cert/meta\\.json is not readable JSON: .+; nothing was certified`));
      assert.doesNotMatch(p.stdout, /browser=/);
      assert.match(f.summary(), new RegExp(`packages/${name}/cert/meta\\.json is not readable JSON`));
      const c = f.leg('ci', name);
      assert.equal(c.status, 1, name);
      assert.match(c.stdout, new RegExp(`::error::packages/${name}/cert/meta\\.json is not readable JSON: .+`));
    }
  } finally {
    f.done();
  }
});

test('a ci: entry that is not a command fails the leg, in plan and in ci', () => {
  const f = fixture({
    empty: { meta: { harness: 'host-node', ci: [''] } },
    spaces: { meta: { harness: 'host-node', ci: ['true', '   '] } },
    number: { meta: { harness: 'host-smoke', ci: [3] } },
    scalar: { meta: { harness: 'host-node', ci: 'true' } },
  });
  try {
    for (const [name, why] of [
      ['empty', 'ci entry 0 is not a command'],
      ['spaces', 'ci entry 1 is not a command'],
      ['number', 'ci entry 0 is not a command'],
      ['scalar', 'ci is not a list of commands'],
    ]) {
      const p = f.leg('plan', name);
      assert.equal(p.status, 1, name);
      assert.ok(p.stderr.includes(`::error::packages/${name}/cert/meta.json: ${why}; nothing was certified`), p.stderr);
      const c = f.leg('ci', name);
      assert.equal(c.status, 1, name);
      assert.ok(c.stdout.includes(`::error::packages/${name}/cert/meta.json: ${why}`), c.stdout);
    }
  } finally {
    f.done();
  }
});
