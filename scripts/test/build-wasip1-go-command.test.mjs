import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'build-wasip1-go-command.sh';
const COPIED = [SCRIPT, 'build-common.sh', 'recipe-env.mjs', 'read-recipe.mjs'];
const GO = '1.27.3';

const FAKE_GO = `#!/bin/sh
case "$1" in
  env) echo "go${GO}" ;;
  build)
    printf '%s\\n' "$@" > "$GO_ARGS"
    while [ $# -gt 0 ]; do
      if [ "$1" = "-o" ]; then mkdir -p "$(dirname "$2")"; printf 'wasm' > "$2"; fi
      shift
    done
    ;;
  list) ;;
  *) echo "fake go: $*" >&2; exit 1 ;;
esac
`;

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function tarball(dir, top, files, out) {
  mkdirSync(join(dir, top), { recursive: true });
  for (const [name, body, mode] of files) {
    mkdirSync(dirname(join(dir, top, name)), { recursive: true });
    writeFileSync(join(dir, top, name), body);
    if (mode) chmodSync(join(dir, top, name), mode);
  }
  const r = spawnSync('tar', ['-czf', out, '-C', dir, top], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return sha256(out);
}

function goBuildArgs({ version = '1.2.3', ldflags, script } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-go-command-')));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const f of COPIED) copyFileSync(join(scripts, f), join(root, 'scripts', f));
    if (script !== undefined) writeFileSync(join(root, 'scripts', SCRIPT), script);
    const work = join(dir, 'work');
    mkdirSync(join(work, 'go-tools'), { recursive: true });
    const machine = `${spawnSync('uname', ['-s']).stdout.toString().trim()}-${spawnSync('uname', ['-m']).stdout.toString().trim()}`;
    const goArch = { 'Linux-x86_64': 'linux-amd64', 'Darwin-arm64': 'darwin-arm64' }[machine];
    if (!goArch) return { skip: `no Go pin for ${machine}` };
    const goSha = tarball(join(dir, 'go-src'), 'go', [
      ['bin/go', FAKE_GO.replace('${GO}', GO), 0o755],
      ['VERSION', `go${GO}\n`],
      ['LICENSE', 'Go licence\n'],
    ], join(work, 'go-tools', `go${GO}.${goArch}.tar.gz`));
    const url = 'https://example.invalid/demo-src.tar.gz';
    const srcSha = tarball(join(dir, 'demo-src'), 'demo', [
      ['LICENSE', 'demo licence\n'],
      ['go.mod', 'module example.com/demo\n'],
    ], join(work, 'demo-demo-src.tar.gz'));
    mkdirSync(join(root, 'packages', 'demo'), { recursive: true });
    writeFileSync(join(root, 'packages', 'demo', 'recipe.yaml'), [
      'name: demo',
      'builder: host',
      `version: "${version}"`,
      'npm: "@ai-ecoverse/demo"',
      'source:',
      `  url: "${url}"`,
      `  sha256: "${srcSha}"`,
      'toolchain:',
      `  go: "${GO}"`,
      `  go_sha256_linux_x64: "${goSha}"`,
      `  go_sha256_macos_arm64: "${goSha}"`,
      'build:',
      '  module: "."',
      '  package: "./cmd/demo"',
      '  command: "demo"',
      ...(ldflags === undefined ? [] : [`  ldflags: "${ldflags}"`]),
      'dependencies:',
      '  build: []',
      '  host: []',
      '  run: []',
      '',
    ].join('\n'));
    const args = join(dir, 'go-args.txt');
    const r = spawnSync('bash', [join(root, 'scripts', SCRIPT), 'demo'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, HOMESCOOP_WORK: work, PREFIX: join(dir, 'prefix'), GO_ARGS: args },
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(`OK demo ${version.replaceAll('.', '\\.')} \\(demo\\)`));
    const argv = readFileSync(args, 'utf8').split('\n').slice(0, -1);
    const dest = join(root, 'packages', 'demo', 'package', 'bin', 'demo.wasm');
    return { argv, dest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const OLD_ARGV = (dest) => ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', dest, './cmd/demo'];
const OKF = { version: '0.5.2', ldflags: '-X main.version={{version}}' };

function okfSpec(r) {
  assert.deepEqual(r.argv, ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid= -X main.version=0.5.2', '-o', r.dest, './cmd/demo']);
}

function variant(edit) {
  const current = readFileSync(join(scripts, SCRIPT), 'utf8');
  const changed = edit(current);
  assert.notEqual(changed, current, 'the variant must change the script');
  return changed;
}

const before = (s) =>
  s
    .split('\n')
    .filter((l) => !l.includes('EXTRA_LDFLAGS='))
    .join('\n')
    .replace('-ldflags="-s -w -buildid=${EXTRA_LDFLAGS:+ $EXTRA_LDFLAGS}"', "-ldflags='-s -w -buildid='");

const unexpanded = (s) =>
  s
    .split('\n')
    .filter((l) => !l.includes('EXTRA_LDFLAGS="${EXTRA_LDFLAGS//'))
    .join('\n');

test('without build.ldflags, go build gets the flags it always had', (t) => {
  const r = goBuildArgs();
  if (r.skip) return t.skip(r.skip);
  assert.deepEqual(r.argv, OLD_ARGV(r.dest));
});

test('an empty build.ldflags is the same as none', (t) => {
  const r = goBuildArgs({ ldflags: '' });
  if (r.skip) return t.skip(r.skip);
  assert.deepEqual(r.argv, OLD_ARGV(r.dest));
});

test('build.ldflags is appended to -s -w -buildid= with {{version}} expanded', (t) => {
  const r = goBuildArgs(OKF);
  if (r.skip) return t.skip(r.skip);
  okfSpec(r);
});

test("every {{version}} is expanded, and the version is the recipe's", (t) => {
  const r = goBuildArgs({ version: '9.10.11', ldflags: '-X main.version={{version}} -X main.tag=v{{version}}' });
  if (r.skip) return t.skip(r.skip);
  assert.equal(r.argv.find((a) => a.startsWith('-ldflags=')), '-ldflags=-s -w -buildid= -X main.version=9.10.11 -X main.tag=v9.10.11');
});

test('NEGATIVE: the script before build.ldflags fails the spec (okf would print version dev)', (t) => {
  const r = goBuildArgs({ ...OKF, script: variant(before) });
  if (r.skip) return t.skip(r.skip);
  assert.deepEqual(r.argv, OLD_ARGV(r.dest));
  assert.throws(() => okfSpec(r), assert.AssertionError);
});

test('NEGATIVE: appending build.ldflags without expanding {{version}} fails the spec', (t) => {
  const r = goBuildArgs({ ...OKF, script: variant(unexpanded) });
  if (r.skip) return t.skip(r.skip);
  assert.ok(r.argv.includes('-ldflags=-s -w -buildid= -X main.version={{version}}'), r.argv.join(' '));
  assert.throws(() => okfSpec(r), assert.AssertionError);
});
