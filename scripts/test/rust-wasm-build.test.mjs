import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { wasiSdkOf } from '../check-rust-wasi-sdk.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(scripts, '..');

const RUST_1_98_1 = `RUN /tmp/build-solaris-toolchain.sh sparcv9  sparcv9  solaris-sparc sun
COPY host-x86_64/dist-various-2/build-x86_64-fortanix-unknown-sgx-toolchain.sh /tmp/
RUN /tmp/build-x86_64-fortanix-unknown-sgx-toolchain.sh

RUN curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz | \\
  tar -xz
ENV WASI_SDK_PATH=/tmp/wasi-sdk-33.0-x86_64-linux
`;

test('wasiSdkOf reads the wasi-sdk tag from a Rust dist-various-2 Dockerfile', () => {
  assert.equal(wasiSdkOf(RUST_1_98_1), 'wasi-sdk-33');
  assert.equal(wasiSdkOf('ENV WASI_SDK_PATH=/tmp/wasi-sdk-25.0\n'), 'wasi-sdk-25');
  assert.throws(() => wasiSdkOf('RUN true\n'), /no WASI_SDK_PATH/);
  assert.throws(() => wasiSdkOf('ENV WASI_SDK_PATH=/tmp/wasi-sdk-31.0\nENV WASI_SDK_PATH=/tmp/wasi-sdk-33.0\n'), /more than one WASI_SDK_PATH: wasi-sdk-31, wasi-sdk-33/);
});

test('check-rust-wasi-sdk: the tag the notice names must be the one the Rust release builds from', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-rust-wasi-sdk-')));
  try {
    const file = join(dir, 'Dockerfile');
    writeFileSync(file, RUST_1_98_1);
    const run = (tag) => spawnSync(process.execPath, [join(scripts, 'check-rust-wasi-sdk.mjs'), '1.98.1', tag, '--dockerfile', file], { encoding: 'utf8' });
    const ok = run('wasi-sdk-33');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Rust 1\.98\.1 builds its wasi-libc from wasi-sdk-33, as the notice says/);
    const bad = run('wasi-sdk-31');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Rust 1\.98\.1 builds its wasi-libc from wasi-sdk-33 \(.*Dockerfile\), but homescoop_notice_rust names wasi-sdk-31/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('homescoop_notice_rust keys the wasi-sdk tag on the Rust version and checks it', () => {
  const sh = readFileSync(join(scripts, 'build-common.sh'), 'utf8');
  const body = sh.slice(sh.indexOf('homescoop_notice_rust() {'), sh.indexOf('\n}\n', sh.indexOf('homescoop_notice_rust() {')));
  const table = body.slice(body.indexOf('case "$rust" in'), body.indexOf('esac'));
  const versions = [...table.matchAll(/^\s+(\d+\.\d+\.\d+)\)\n([\s\S]*?);;/gm)];
  assert.ok(versions.length > 0, 'no Rust versions in the table');
  for (const [, rust, entry] of versions) {
    assert.match(entry, /^\s+wasisdk=wasi-sdk-\d+$/m, `Rust ${rust} has no wasisdk= in homescoop_notice_rust's table`);
  }
  assert.match(body, /check-rust-wasi-sdk\.mjs" "\$rust" "\$wasisdk"/);
  assert.doesNotMatch(body.slice(body.indexOf('esac')), /wasi-sdk-\d+/, 'a literal wasi-sdk-N after the table');
  assert.match(body, /wasi-libc\/\$wasisdk\n/);
  assert.match(body, /"wasi-libc \(\$wasisdk; Rust's self-contained \$target libc\)"/);
});

function wasmOpt(fake) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-wasm-opt-')));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of ['bash', 'wc', 'tr', 'mv', 'rm', 'mkdir', 'cat', 'node', 'dirname', 'head']) {
    const w = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (w) writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${w}" "$@"\n`), chmodSync(join(bin, tool), 0o755);
  }
  if (fake) {
    writeFileSync(join(bin, 'wasm-opt'), `#!/bin/sh\n${fake}\n`);
    chmodSync(join(bin, 'wasm-opt'), 0o755);
  }
  const wasm = join(dir, 'x.wasm');
  writeFileSync(wasm, 'unoptimised-module');
  const r = spawnSync(
    join(bin, 'bash'),
    ['-c', 'source "$HOMESCOOP_ROOT/scripts/build-common.sh"; homescoop_wasm_opt "$1" demo --enable-bulk-memory; echo "rc=$?"', 'x', wasm],
    {
      encoding: 'utf8',
      env: { PATH: bin, HOMESCOOP_ROOT: root, HOMESCOOP_WORK: join(dir, 'work'), PREFIX: join(dir, 'prefix') },
    },
  );
  const out = { ...r, out: `${r.stdout}${r.stderr}`, wasm: readFileSync(wasm, 'utf8'), leftover: spawnSync('ls', [dir], { encoding: 'utf8' }).stdout };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

test('homescoop_wasm_opt: no wasm-opt on PATH fails the build', () => {
  const r = wasmOpt(null);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /demo: wasm-opt is not on PATH; build through scripts\/host-run\.sh/);
  assert.doesNotMatch(r.out, /rc=0/);
  assert.equal(r.wasm, 'unoptimised-module');
});

test('homescoop_wasm_opt: a wasm-opt that rejects the module fails the build and leaves no .opt file', () => {
  const r = wasmOpt('[ "$1" = --version ] && { echo "wasm-opt version 125"; exit 0; }; echo "[wasm-validator error] bulk memory" >&2; exit 1');
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /\[wasm-validator error\] bulk memory/);
  assert.match(r.out, /demo: wasm-opt rejected .*x\.wasm/);
  assert.doesNotMatch(r.leftover, /x\.wasm\.opt/);
  assert.equal(r.wasm, 'unoptimised-module');
});

test('homescoop_wasm_opt: optimises in place and logs the version, flags and sizes', () => {
  const r = wasmOpt('[ "$1" = --version ] && { echo "wasm-opt version 125"; exit 0; }; for a; do case "$prev" in -o) printf opt > "$a";; esac; prev=$a; done; echo "$*" > /dev/stderr');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /== demo: wasm-opt version 125 -Oz --strip-debug --enable-bulk-memory\n/);
  assert.match(r.out, /-Oz --strip-debug --enable-bulk-memory .*x\.wasm -o .*x\.wasm\.opt/);
  assert.match(r.out, /== demo: wasm-opt 18 -> 3 bytes\nrc=0/);
  assert.equal(r.wasm, 'opt');
});
