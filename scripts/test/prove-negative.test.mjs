import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const STUB = `import { mkdtempSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const argv = process.argv.slice(2);
const at = (n) => argv[argv.indexOf(n) + 1];
const dir = mkdtempSync(join(tmpdir(), 'stub-'));
spawnSync('tar', ['-xzf', at('--tarball'), '-C', dir]);
const sizes = {};
for (const f of JSON.parse(process.env.STUB_FILES)) sizes[f] = statSync(join(dir, 'package', f)).size;
appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv, sizes }) + '\\n');
const mode = process.env.STUB_MODE;
const empty = Object.entries(sizes).filter(([f]) => JSON.parse(process.env.STUB_RUNS).includes(f)).every(([, n]) => n === 0);
const specs = mode === 'boot' ? [] : mode === 'noexport' ? [{ spec: 'checklist.mjs', status: 'fail', durationMs: 0, error: 'no default export' }] : [{ spec: 'checklist.mjs', status: empty && mode !== 'pass' ? 'fail' : 'pass' }];
const status = mode === 'boot' || specs.some((s) => s.status === 'fail') ? 1 : 0;
writeFileSync(at('--json'), JSON.stringify({ specs, error: mode === 'boot' ? '@ai-ecoverse/slicc-shared-web not found' : null, status: status ? 'fail' : 'pass' }));
process.exit(status);
`;

function fixture(files, manifest, links = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-prove-negative-')));
  mkdirSync(join(root, 'scripts', 'browser-cert'), { recursive: true });
  copyFileSync(join(scripts, 'browser-cert', 'prove-negative.mjs'), join(root, 'scripts', 'browser-cert', 'prove-negative.mjs'));
  writeFileSync(join(root, 'scripts', 'browser-cert', 'run.mjs'), STUB);
  const pkg = join(root, 'src', 'package');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@ai-ecoverse/fixture', version: '1.0.0-1', ...manifest }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    writeFileSync(join(pkg, rel), body);
    chmodSync(join(pkg, rel), 0o755);
  }
  for (const [rel, target] of Object.entries(links)) {
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    symlinkSync(target.replace('$ROOT', root), join(pkg, rel));
  }
  writeFileSync(join(root, 'outside.wasm'), WASM);
  const tgz = join(root, 'good.tgz');
  spawnSync('tar', ['-czf', tgz, '-C', join(root, 'src'), 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const log = join(root, 'stub.log');
  const prove = (runs, mode = 'spec', extra = []) => {
    rmSync(log, { force: true });
    const r = spawnSync(process.execPath, [join(root, 'scripts/browser-cert/prove-negative.mjs'), '--package', 'fixture', '--tarball', tgz, ...extra], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: root, STUB_LOG: log, STUB_MODE: mode, STUB_FILES: JSON.stringify(Object.keys(files)), STUB_RUNS: JSON.stringify(runs) },
    });
    let calls = [];
    try {
      calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    } catch {}
    return { ...r, out: `${r.stdout}${r.stderr}`, calls };
  };
  return { prove, outside: () => readFileSync(join(root, 'outside.wasm')), done: () => rmSync(root, { recursive: true, force: true }) };
}

const ruby = {
  slicc: { abi: 'wasix', commands: { ruby: { wasm: 'bin/ruby' }, irb: { wasm: 'bin/ruby', argv0: 'irb' }, erb: { wasm: '${package}/bin/ruby' } } },
};

test('a command wasm without a .wasm suffix (wasix-ruby bin/ruby) is emptied, and the negative is proven', () => {
  const f = fixture({ 'bin/ruby': WASM, 'lib/ruby/3.4.0/set.rb': 'class Set; end\n', 'lib/x.so': WASM, 'README.md': 'hi\n' }, ruby);
  try {
    const r = f.prove(['bin/ruby']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /prove-negative: emptied 1 module\(s\): bin\/ruby\n/);
    assert.match(r.out, /prove-negative: ok — cert failed on bad fixture tarball \(status 1; 1 of 1 spec\(s\) failed: checklist\.mjs\)/);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(r.calls[0].sizes, { 'bin/ruby': 0, 'lib/ruby/3.4.0/set.rb': 15, 'lib/x.so': 8, 'README.md': 3 });
  } finally {
    f.done();
  }
});

test('bin/*.wasm, command wasm files outside bin/ and \\0asm files under bin/ are all emptied; glue is not', () => {
  const manifest = {
    slicc: {
      abi: 'emscripten',
      commands: { jq: { glue: 'bin/jq', wasm: 'bin/jq.wasm' }, tool: { wasm: './libexec/tool' } },
    },
  };
  const f = fixture(
    { 'bin/jq': '#!/usr/bin/env node\n', 'bin/jq.wasm': WASM, 'bin/extra.wasm': WASM, 'bin/helper': WASM, 'libexec/tool': WASM },
    manifest,
  );
  try {
    const r = f.prove(['bin/jq.wasm', 'libexec/tool']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /emptied 4 module\(s\): bin\/extra\.wasm, bin\/helper, bin\/jq\.wasm, libexec\/tool\n/);
    assert.deepEqual(r.calls[0].sizes, { 'bin/jq': 20, 'bin/jq.wasm': 0, 'bin/extra.wasm': 0, 'bin/helper': 0, 'libexec/tool': 0 });
  } finally {
    f.done();
  }
});

test('nothing to corrupt fails, and names a slicc.commands wasm the tarball lacks', () => {
  const f = fixture({ 'bin/tool.js': 'console.log(1)\n' }, { slicc: { commands: { tool: { wasm: 'bin/tool' } } } });
  try {
    const r = f.prove([]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /slicc\.commands names bin\/tool as wasm, but the tarball has no such file/);
    assert.match(r.out, /prove-negative: no WebAssembly module to corrupt/);
    assert.equal(r.calls.length, 0);
  } finally {
    f.done();
  }
});

test('a cert that passes on the corrupted tarball, or never runs a spec, proves nothing', () => {
  const f = fixture({ 'bin/ruby': WASM }, ruby);
  try {
    const pass = f.prove(['bin/ruby'], 'pass');
    assert.equal(pass.status, 1, pass.out);
    assert.match(pass.out, /cert unexpectedly PASSED on corrupted wasm/);
    const boot = f.prove(['bin/ruby'], 'boot');
    assert.equal(boot.status, 1, boot.out);
    assert.match(boot.out, /the cert did not get to run a spec \(@ai-ecoverse\/slicc-shared-web not found\); nothing is proven/);
    const noexport = f.prove(['bin/ruby'], 'noexport');
    assert.equal(noexport.status, 1, noexport.out);
    assert.match(noexport.out, /the cert did not get to run a spec .*; nothing is proven/);
  } finally {
    f.done();
  }
});

test('run.mjs flags pass through; the corrupted tarball comes first and the report is prove-negative\'s', () => {
  const f = fixture({ 'bin/ruby': WASM }, ruby);
  try {
    const r = f.prove(['bin/ruby'], 'spec', ['--kernel', '1.93.0', '--users', 'enforce', '--tarball', '/tmp/peer.tgz', '--json', '/tmp/ignored.json']);
    assert.equal(r.status, 0, r.out);
    const { argv } = r.calls[0];
    assert.equal(argv[argv.indexOf('--tarball') + 1].endsWith('bad.tgz'), true);
    assert.equal(argv.filter((a) => a === '--json').length, 1);
    assert.notEqual(argv[argv.indexOf('--json') + 1], '/tmp/ignored.json');
    assert.deepEqual(argv.slice(argv.indexOf('--json') + 2), ['--kernel', '1.93.0', '--users', 'enforce', '--tarball', '/tmp/peer.tgz']);
  } finally {
    f.done();
  }
});

test('a command wasm outside the package, or a link, is refused and left alone', () => {
  for (const [manifest, links] of [
    [{ slicc: { commands: { ruby: { wasm: '../../../outside.wasm' } } } }, {}],
    [{ slicc: { commands: { ruby: { wasm: 'bin/ruby' } } } }, { 'bin/ruby': '$ROOT/outside.wasm' }],
    [{ slicc: { commands: {} } }, { bin: '$ROOT' }],
  ]) {
    const f = fixture({ 'lib/keep.txt': 'x' }, manifest, links);
    try {
      const r = f.prove([]);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /: a link, or outside the package; refusing to touch it/);
      assert.equal(r.calls.length, 0);
      assert.deepEqual(f.outside(), WASM);
    } finally {
      f.done();
    }
  }
});
