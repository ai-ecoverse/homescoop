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
  for (const f of ['cert-leg.mjs', 'cert-meta.mjs', 'glue.mjs']) copyFileSync(join(scripts, 'browser-cert', f), join(root, 'scripts', 'browser-cert', f));
  copyFileSync(join(scripts, 'dev-pin.mjs'), join(root, 'scripts', 'dev-pin.mjs'));
  copyFileSync(join(scripts, 'gate.mjs'), join(root, 'scripts', 'gate.mjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@ai-ecoverse/slicc-kernel': '1.102.6' } }));
  // A stand-in run.mjs: records each invocation (argv and the env it got).
  writeFileSync(
    join(root, 'scripts', 'browser-cert', 'run.mjs'),
    "import { appendFileSync } from 'node:fs';\nappendFileSync('runs.jsonl', JSON.stringify({ argv: process.argv.slice(2), env: { K: process.env.TAR_LINKAT || null } }) + '\\n');\nif (!process.env.SILENT_RUN) console.log(process.argv.includes('--fail-me') ? 'cert-run: FAIL stub' : 'cert-run: PASS stub');\nprocess.exit(process.argv.includes('--fail-me') ? 4 : 0);\n",
  );
  for (const [name, { meta, specs = [], manifest = {} }] of Object.entries(packages)) {
    const dir = join(root, 'packages', name);
    mkdirSync(join(dir, 'package'), { recursive: true });
    writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: `@ai-ecoverse/${name}`, ...manifest }));
    if (meta || specs.length) mkdirSync(join(dir, 'cert'), { recursive: true });
    if (meta) writeFileSync(join(dir, 'cert', 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
    for (const s of specs) writeFileSync(join(dir, 'cert', s), 'export default async () => {};\n');
  }
  const summary = join(root, 'summary.md');
  const leg = (mode, name, env = {}) =>
    spawnSync(
      process.execPath,
      [join(root, 'scripts/browser-cert/cert-leg.mjs'), mode, name, ...(mode === 'plan' || mode === 'browser-extra' ? ['--manifest', join(root, 'packages', name, 'package', 'package.json')] : [])],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary, ...env } },
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

test('a cert/meta.json that is JSON but not an object fails the leg, in plan and in ci', () => {
  const f = fixture({
    list: { meta: '[]' },
    word: { meta: '"host-node"' },
    number: { meta: '42' },
    yes: { meta: 'true' },
    nothing: { meta: 'null' },
    listed: { meta: '[{ "harness": "host-node", "ci": ["true"] }]' },
  });
  try {
    for (const [name, kind] of [
      ['list', 'an array'],
      ['word', 'a string'],
      ['number', 'a number'],
      ['yes', 'a boolean'],
      ['nothing', 'null'],
      ['listed', 'an array'],
    ]) {
      const why = `packages/${name}/cert/meta.json is not a JSON object (it is ${kind}); nothing was certified`;
      const p = f.leg('plan', name);
      assert.equal(p.status, 1, name);
      assert.ok(p.stderr.includes(`::error::${why}`), p.stderr);
      assert.doesNotMatch(p.stdout, /browser=/);
      assert.doesNotMatch(p.stderr, /::warning::/);
      assert.ok(f.summary().includes(why), name);
      const c = f.leg('ci', name);
      assert.equal(c.status, 1, name);
      assert.ok(c.stdout.includes(`::error::${why}`), c.stdout);
    }
  } finally {
    f.done();
  }
});

test('peers: a list of other recipes is printed for the artifact download; anything else fails the leg', () => {
  const f = fixture({
    kits: { meta: { harness: 'host-node', ci: ['true'], peers: ['run1', 'run2'] } },
    run1: {},
    run2: {},
    self: { meta: { harness: 'host-node', ci: ['true'], peers: ['self'] } },
    word: { meta: { harness: 'host-node', ci: ['true'], peers: 'run1' } },
    none: { meta: { harness: 'host-node', ci: ['true'], peers: [] } },
    glob: { meta: { harness: 'host-node', ci: ['true'], peers: ['run*'] } },
    ghost: { meta: { harness: 'host-node', ci: ['true'], peers: ['run1', 'nope'] } },
  });
  try {
    for (const r of ['run1', 'run2']) writeFileSync(join(f.root, 'packages', r, 'recipe.yaml'), `name: ${r}\n`);
    const p = f.leg('plan', 'kits');
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual(p.stdout.trim().split('\n'), ['browser=skip', 'peers=run1|run2']);
    assert.match(p.stderr, /cert leg: peers run1, run2/);
    assert.equal(f.leg('ci', 'kits').status, 0);
    for (const [name, why] of [
      ['self', 'peers is not a list of other recipe names'],
      ['word', 'peers is not a list of other recipe names'],
      ['none', 'peers is not a list of other recipe names'],
      ['glob', 'peers is not a list of other recipe names'],
      ['ghost', 'peers nope is not a recipe'],
    ]) {
      const r = f.leg('plan', name);
      assert.equal(r.status, 1, name);
      assert.ok(r.stderr.includes(`::error::packages/${name}/cert/meta.json: ${why}; nothing was certified`), r.stderr);
      assert.doesNotMatch(r.stdout, /peers=/);
      const c = f.leg('ci', name);
      assert.equal(c.status, 1, name);
    }
  } finally {
    f.done();
  }
});

const runsOf = (root) =>
  existsSync(join(root, 'runs.jsonl'))
    ? readFileSync(join(root, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];

test('extra_kernels (#663): ci runs an object entry\'s commands with HOMESCOOP_CERT_KERNEL and its env; string notes run nothing', () => {
  const f = fixture({
    sys: {
      meta: {
        harness: 'host-node',
        kernel: '@ai-ecoverse/slicc-kernel@1.100.1',
        ci: ['echo "main $HOMESCOOP_CERT_KERNEL" >> ran'],
        extra_kernels: [
          '@ai-ecoverse/slicc-kernel@1.47.1 (checked by hand)',
          { kernel: '@ai-ecoverse/slicc-kernel@1.102.2', why: 'R31_SEMS', env: { R31_SEMS: '1' }, ci: ['echo "extra $HOMESCOOP_CERT_KERNEL $R31_SEMS" >> ran'] },
        ],
      },
    },
    badextra: {
      meta: { harness: 'host-node', ci: ['true'], extra_kernels: [{ kernel: '@ai-ecoverse/slicc-kernel@1.102.2', why: 'x', ci: ['exit 5'] }] },
    },
  });
  try {
    assert.equal(f.leg('plan', 'sys').status, 0);
    const r = f.leg('ci', 'sys');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(readFileSync(join(f.root, 'ran'), 'utf8'), 'main \nextra @ai-ecoverse/slicc-kernel@1.102.2 1\n');
    assert.match(r.stdout, /host cert \(extra kernel @ai-ecoverse\/slicc-kernel@1\.102\.2\)/);
    const b = f.leg('ci', 'badextra');
    assert.equal(b.status, 5);
    assert.match(b.stdout, /::error::badextra: host cert command failed \(extra kernel @ai-ecoverse\/slicc-kernel@1\.102\.2\) \(5\): exit 5/);
  } finally {
    f.done();
  }
});

test('extra_kernels: a malformed object entry fails the leg, in plan and in ci', () => {
  const k = '@ai-ecoverse/slicc-kernel@1.102.2';
  const cases = {
    notlist: [{ extra_kernels: 'x' }, /extra_kernels is not a list/],
    number: [{ extra_kernels: [3] }, /extra_kernels\[0\] is neither a note nor an object/],
    range: [{ extra_kernels: [{ kernel: '@ai-ecoverse/slicc-kernel@^1.102.0', why: 'x', specs: true }] }, /kernel is not an exact/],
    nowhy: [{ extra_kernels: [{ kernel: k, specs: true }] }, /has no why/],
    nothing: [{ extra_kernels: [{ kernel: k, why: 'x' }] }, /runs nothing/],
    typo: [{ extra_kernels: [{ kernel: k, why: 'x', spec: ['a.mjs'] }] }, /unknown key\(s\) spec/],
    specs: [{ extra_kernels: [{ kernel: k, why: 'x', specs: ['../a.mjs'] }] }, /specs is not true or a list/],
    env: [{ extra_kernels: [{ kernel: k, why: 'x', specs: true, env: { A: 1 } }] }, /env is not an object/],
    cert: [{ extra_kernels: [{ kernel: k, why: 'x', specs: true, cert: 'nope' }] }, /cert is not a subdirectory/],
    absent: [{ extra_kernels: [{ kernel: k, why: 'x', specs: ['b.mjs'] }] }, /specs b\.mjs not in cert\//],
    hostspecs: [{ harness: 'host-node', ci: ['true'], extra_kernels: [{ kernel: k, why: 'x', specs: true }] }, /harness host-node runs no browser specs/],
  };
  const f = fixture(Object.fromEntries(Object.entries(cases).map(([n, [meta]]) => [n, { meta, specs: ['a.mjs'] }])));
  try {
    // specs: true on a cert/ subdirectory with no spec in it would run nothing.
    mkdirSync(join(f.root, 'packages', 'emptydir', 'cert', 'empty'), { recursive: true });
    mkdirSync(join(f.root, 'packages', 'emptydir', 'package'));
    writeFileSync(join(f.root, 'packages', 'emptydir', 'package', 'package.json'), '{}');
    writeFileSync(join(f.root, 'packages', 'emptydir', 'cert', 'meta.json'), JSON.stringify({ extra_kernels: [{ kernel: k, why: 'x', specs: true, cert: 'empty' }] }));
    cases.emptydir = [null, /cert\/empty\/ has no \*\.mjs spec, so nothing would run/];
    for (const [name, [, re]] of Object.entries(cases)) {
      const p = f.leg('plan', name);
      assert.equal(p.status, 1, name);
      assert.match(p.stderr, re, name);
      const c = f.leg('ci', name);
      assert.equal(c.status, 1, name);
      assert.match(c.stdout, re, name);
    }
  } finally {
    f.done();
  }
});

test('browser-extra: glue by path on the dev-pin kernel when the cert kernel predates 1.86 (#628), and extra_kernels specs (#663)', () => {
  const f = fixture({
    old: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.12.0' }, specs: ['a.mjs'], manifest: cli },
    off: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.94.0', users: 'off' }, specs: ['a.mjs'], manifest: cli },
    fine: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.94.0', users: 'enforce' }, specs: ['a.mjs'], manifest: cli },
    pinned: { meta: {}, specs: ['a.mjs'], manifest: cli },
    optout: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.12.0', glueByPath: false }, specs: ['a.mjs'], manifest: cli },
    wasm: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.12.0' }, specs: ['a.mjs'], manifest: wasi },
    tar: {
      meta: {
        kernel: '@ai-ecoverse/slicc-kernel@1.88.0',
        users: 'enforce',
        extra_kernels: [
          '@ai-ecoverse/slicc-kernel@1.77.0 (a note)',
          { kernel: '@ai-ecoverse/slicc-kernel@1.90.0', why: 'linkat', specs: true, env: { TAR_LINKAT: '1' } },
          { kernel: '@ai-ecoverse/slicc-kernel@1.108.1', why: 'k108', specs: ['inherit.mjs'], cert: 'k108', users: 'report' },
        ],
      },
      specs: ['a.mjs'],
      manifest: cli,
    },
  });
  try {
    mkdirSync(join(f.root, 'packages', 'tar', 'cert', 'k108'));
    writeFileSync(join(f.root, 'packages', 'tar', 'cert', 'k108', 'inherit.mjs'), 'export default async () => {};\n');
    for (const name of ['old', 'off']) {
      const r = f.leg('browser-extra', name);
      assert.equal(r.status, 0, r.stdout);
    }
    for (const name of ['fine', 'pinned', 'optout', 'wasm']) {
      const r = f.leg('browser-extra', name);
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, /no extra runs/, name);
    }
    const tar = f.leg('browser-extra', 'tar');
    assert.equal(tar.status, 0, tar.stdout);
    const base = (p) => ['--package', p, '--tarball', '.homescoop-out/package.tgz'];
    assert.deepEqual(runsOf(f.root), [
      { argv: [...base('old'), '--kernel', '@ai-ecoverse/slicc-kernel@1.102.6', '--users', 'enforce', '--glue-only'], env: { K: null } },
      { argv: [...base('off'), '--kernel', '@ai-ecoverse/slicc-kernel@1.102.6', '--users', 'enforce', '--glue-only'], env: { K: null } },
      { argv: [...base('tar'), '--kernel', '@ai-ecoverse/slicc-kernel@1.90.0'], env: { K: '1' } },
      { argv: [...base('tar'), '--kernel', '@ai-ecoverse/slicc-kernel@1.108.1', '--cert', 'packages/tar/cert/k108', '--spec', 'inherit.mjs', '--users', 'report'], env: { K: null } },
    ]);
  } finally {
    f.done();
  }
});

test('browser-extra: a run.mjs that exits 0 without its cert-run verdict fails the leg (#981)', () => {
  const f = fixture({ old: { meta: { kernel: '@ai-ecoverse/slicc-kernel@1.12.0' }, specs: ['a.mjs'], manifest: cli } });
  try {
    const r = f.leg('browser-extra', 'old', { SILENT_RUN: '1' });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /cert-run: exited 0 without a "cert-run: PASS" line/);
    assert.match(r.stdout, /^cert-leg: FAIL browser-extra old$/m);
    const ok = f.leg('browser-extra', 'old');
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /^cert-leg: PASS browser-extra old$/m);
  } finally {
    f.done();
  }
});
