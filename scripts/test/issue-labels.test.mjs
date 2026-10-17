import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LABELS, TRIAGE, areaOf, glob, labelsFor, listPackages, packagesIn, unlabelled } from '../issue-labels.mjs';

const packages = listPackages();

const TABLE = [
  ['slicc-kernel: mkfifo("/") gives EIO instead of EEXIST (path_mkfifo on the root, like slicc-kernel#659)', ['area:kernel']],
  ["[cert] slicc-kernel: a SIGTERM'd WASIX gpg writing from its signal handler throws 'Invalid regular expression … Stack overflow' in WasiSignals.muted", ['area:kernel']],
  ["slicc-kernel: ~60+ concurrent wasm processes fail with 'WebAssembly.instantiate(): Out of memory' (rc 70); parallel pipelines silently lose output", ['area:kernel', 'data-integrity']],
  ['[cert] wasix-automake: no spec runs autoreconf, SUBDIRS or aux/macro dirs, or runs as a non-root user', ['cert-coverage', 'next-build']],
  ['util-linux: ship flock(1) now that Emscripten flock() reaches the kernel (homescoop#947)', ['next-build']],
  ["[repro] gmake, file, jq: configure-time build-host paths in the wasm (make's default CXX is the CI emsdk em++)", ['repro', 'next-build']],
  ['wasix-sysroot -34: poll on a reader-less pipe write end with POLLIN|POLLOUT gives POLLIN|POLLHUP|POLLERR, not POLLOUT|POLLERR; empty read end gets POLLIN with POLLHUP', ['area:sysroot', 'next-build']],
  ['Emscripten shim: seed the sigaction table with SIG_IGN dispositions inherited across exec/spawn (slicc-kernel#820 item 1)', ['area:toolchain']],
  ['[repro] wasm-libheif: heif_version.h ships LIBHEIF_PLUGIN_DIRECTORY=/tmp/homescoop-work/... (build path)', ['repro', 'next-build']],
  ['[cert] check-no-debug.mjs silently does nothing through a symlinked checkout (cloud-run runners): #908 strip and DWARF gate skipped', ['ci', 'next-build']],
  ['wasm-clang 24.0.0-21: WASIXCC_WASM_EXCEPTIONS=legacy still emits exnref; sysroot-ehpic link aborts in wasm-opt --asyncify (before pinning wasix-sysroot >= -33)', ['area:toolchain', 'next-build']],
  ['wasix-sysroot -33: package.json description says clang24 exnref; share/wasm32-wasi check files dropped', ['area:sysroot', 'docs', 'next-build']],
  ['[repro] wasm-libpng, wasm-libtiff, wasm-libxml2 (and the imagemagick relink kit): .a archives embed the build checkout path', ['repro', 'next-build']],
  ['wasi-llvm 21.1.8-1: README link example fails (llvm-config components miss lto/passes that lldWasm needs)', ['area:toolchain', 'docs', 'next-build']],
  ["[cert] wasm-go, wasm-go-std-*: Go's PATENTS grant isn't shipped next to LICENSE", ['area:toolchain', 'license', 'next-build']],
  ['[cert] which, tree, util-linux, bzip2, procps: no cert spec checks the shipped THIRD-PARTY-NOTICES.md (#684)', ['license', 'cert-coverage', 'next-build']],
  ['[plan] wasix-sysroot 2025.9.30-33: re-root from source in CI (wasix-libc v2025-09-02.1 + pinned LLVM runtimes) (#864)', ['area:sysroot']],
  ["[nano] nano -G (--locking) can't write its lock file: build.sh doesn't link the getpwuid wrap (homescoop_slicc_wrap_pwd)", ['next-build']],
  ['py-pandas 2.3.3-11: source.sha256 matches neither the PyPI sdist nor the GitHub archive', ['area:python', 'supply-chain', 'next-build']],
  ['wasix-python: ships the build directory in every .pyc', ['area:python', 'repro', 'next-build']],
  ['wasix-gnupg: dotlock data loss on OPFS (no hard links)', ['data-integrity', 'next-build']],
  ['pool-parity: pool builds differ from their hosted twins', ['repro', 'ci']],
  ['publish-failure: @ai-ecoverse/wasm-xxd@9.2.1186-1', ['ci']],
  ['Some idea with no rule', [TRIAGE]],
];

describe('labelsFor, on real titles', () => {
  for (const [title, want] of TABLE) {
    it(title.slice(0, 80), () => assert.deepEqual(labelsFor(title, packages), want));
  }
});

describe('packagesIn', () => {
  it('reads only the leading package list, not words later in the title', () => {
    assert.deepEqual(packagesIn("[nano] nano -G (--locking) can't write its lock file: x", packages), ['nano']);
    assert.deepEqual(packagesIn('wasix-sysroot -33: sysroot-ehpic drops x (wasix-python’s build guard needs it)', packages), ['wasix-sysroot']);
  });

  it('maps npm names to recipe dirs and expands globs', () => {
    assert.deepEqual(packagesIn('[cert] wasm-go, wasm-go-std-*: x', packages), ['wasm-go', 'wasm-go-std-linux-amd64', 'wasm-go-std-wasip1']);
    assert.deepEqual(packagesIn('wasm-sed 4.10-3: x', packages), ['sed']);
  });
});

describe('glob', () => {
  it('matches linearly, so a hostile title can\'t stall the job', () => {
    assert.equal(glob('wasm-go-std-*', 'wasm-go-std-wasip1'), true);
    assert.equal(glob('*-std-*', 'wasm-go-std-wasip1'), true);
    assert.equal(glob('wasm-*-x', 'wasm-go'), false);
    const t = Date.now();
    assert.deepEqual(labelsFor(`${'*'.repeat(5000)}z: hi`, packages), [TRIAGE]);
    assert.deepEqual(labelsFor(`${'a*'.repeat(5000)}z: hi`, packages), [TRIAGE]);
    assert.ok(Date.now() - t < 2000);
  });

  it('ignores a bare wildcard', () => {
    assert.deepEqual(packagesIn('*: everything', packages), []);
  });
});

describe('unlabelled', () => {
  it('keeps open issues with no labels, not pull requests or the skipped ones', () => {
    const issues = [
      { number: 1, labels: [] },
      { number: 2, labels: [{ name: 'ci' }] },
      { number: 3, labels: [], pull_request: {} },
      { number: 7, labels: [] },
      { number: 390, labels: [] },
    ];
    assert.deepEqual(unlabelled(issues).map((i) => i.number), [1]);
  });
});

describe('areaOf', () => {
  it('follows the brief', () => {
    assert.equal(areaOf('py-numpy'), 'area:python');
    assert.equal(areaOf('wasix-python'), 'area:python');
    assert.equal(areaOf('wasix-sysroot'), 'area:sysroot');
    for (const p of ['wasm-clang', 'wasm-emscripten', 'wasm-binaryen', 'wasi-llvm', 'wasm-go', 'wasm-go-std-wasip1']) assert.equal(areaOf(p), 'area:toolchain');
    assert.equal(areaOf('sed'), null);
  });
});

describe('the filers', () => {
  it('only ever produce known labels', () => {
    for (const [title] of TABLE) for (const l of labelsFor(title, packages)) assert.ok(LABELS.includes(l), l);
  });

  it('pool-parity labels its issue', () => {
    const yml = readFileSync(new URL('../../.github/workflows/pool-parity.yml', import.meta.url), 'utf8');
    assert.match(yml, /issues\.create\(\{[^}]*labels: \[label, 'repro', 'ci'\]/);
  });

  it('cert-review tells its reviewer to label what it files', () => {
    const yml = readFileSync(new URL('../../.github/workflows/cert-review.yml', import.meta.url), 'utf8');
    const prompt = yml.slice(yml.indexOf('gh issue create'), yml.indexOf('YOUR ANSWER'));
    for (const l of ['next-build', 'area:kernel', 'area:python', 'area:sysroot', 'area:toolchain', 'repro', 'license', 'supply-chain', 'data-integrity', 'cert-coverage']) assert.ok(prompt.includes(`\`${l}\``), l);
    assert.match(prompt, /`--label`/);
    assert.match(prompt, /\[cert\] <package>: …/);
  });

  it('the fallback (issues opened, plus an hourly sweep for GITHUB_TOKEN filers) runs this script with issues: write only', () => {
    const yml = readFileSync(new URL('../../.github/workflows/issue-labels.yml', import.meta.url), 'utf8');
    assert.match(yml, /issues:\s*\n\s*types: \[opened\]/);
    assert.match(yml, /schedule:\s*\n\s*- cron:/);
    assert.match(yml, /node scripts\/issue-labels\.mjs --backlog --apply/);
    const lines = yml.split('\n');
    const at = lines.indexOf('permissions:');
    const block = [];
    for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) block.push(lines[i].trim());
    assert.deepEqual(block, ['issues: write']);
    assert.equal(lines.filter((l) => /^\s*permissions:/.test(l)).length, 1);
    assert.match(yml, /node scripts\/issue-labels\.mjs --event/);
  });
});
