#!/usr/bin/env node
/**
 * Host smoke for wasm-cmake 4.4.3-4 (CMAKE_ROOT env).
 *
 * Reproduces the SLICC layout: bin/cmake sits away from share/, CMAKE_ROOT
 * points at the package module tree. Single callMain per process (EXIT_RUNTIME).
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages/cmake/package');
const glueSrc = join(pkg, 'bin/cmake');
const runCli = join(root, 'scripts/run-wasm-cli.mjs');
const modules = join(pkg, 'share/cmake-4.4');

chmodSync(glueSrc, 0o755);

const work = mkdtempSync(join(tmpdir(), 'cmake-smoke-'));
// Binaries alone under /work/bin — no share tree next to them (SLICC /usr/bin case).
mkdirSync(join(work, 'bin'));
copyFileSync(glueSrc, join(work, 'bin/cmake'));
copyFileSync(join(pkg, 'bin/cmake.wasm'), join(work, 'bin/cmake.wasm'));
chmodSync(join(work, 'bin/cmake'), 0o755);
// Modules only reachable via CMAKE_ROOT (not via install-tree from argv0).
spawnSync('rsync', ['-a', modules + '/', join(work, 'cmake-root') + '/'], { stdio: 'inherit' });
mkdirSync(join(work, 'proj'));
writeFileSync(
  join(work, 'proj', 'CMakeLists.txt'),
  `cmake_minimum_required(VERSION 3.20)
project(x LANGUAGES NONE)
file(WRITE "\${CMAKE_BINARY_DIR}/gen.txt" "generated")
add_custom_target(gen ALL)
`
);
writeFileSync(join(work, 's.cmake'), 'message(STATUS "sum=1")\nfile(WRITE "/work/p.out" "42")\n');
writeFileSync(join(work, 'd.txt'), 'hello\n');

function run(args) {
  const r = spawnSync(process.execPath, [runCli, join(work, 'bin/cmake'), '--', ...args], {
    env: {
      ...process.env,
      SMOKE_WORKDIR: work,
      // Mimic registry argv0 (/usr/bin/cmake): prefix /work → would look in /work/share.
      SMOKE_THISPROGRAM: '/work/bin/cmake',
      CMAKE_ROOT: '/work/cmake-root',
    },
    encoding: 'utf8',
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  console.log(out.split('\n').filter((l) => l.length < 400).join('\n').trimEnd());
  console.log(`rc=${r.status} :: cmake ${args.join(' ')}`);
  if (badRuntime(out)) {
    console.error('cmake smoke: ABI/runtime failure in output');
    return 1;
  }
  return r.status ?? 1;
}

function badRuntime(out) {
  return /registered more than once/i.test(out) || /RuntimeError|Aborted\(/.test(out);
}

let fail = 0;
// --version is not a sufficient ABI smoke (passes with stride-20 sigaction).
const echo = run(['-E', 'echo', 'hello']);
fail += echo !== 0;
fail += run(['-E', 'sha256sum', '/work/d.txt']) !== 0;
fail += run(['-P', '/work/s.cmake']) !== 0;
if (!existsSync(join(work, 'p.out')) || readFileSync(join(work, 'p.out'), 'utf8') !== '42') {
  console.error('p.out missing/wrong');
  fail++;
}

const cfg = run([
  '-S',
  '/work/proj',
  '-B',
  '/work/build',
  '-G',
  'Unix Makefiles',
  '-DCMAKE_MAKE_PROGRAM=/usr/bin/true',
]);
const cache = join(work, 'build', 'CMakeCache.txt');
if (!existsSync(cache)) {
  console.error('no CMakeCache.txt — CMAKE_ROOT env did not resolve modules');
  fail++;
} else {
  const rootLine = readFileSync(cache, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('CMAKE_ROOT:'));
  console.log('cache', rootLine);
  if (rootLine !== 'CMAKE_ROOT:INTERNAL=/work/cmake-root') {
    console.error('CMAKE_ROOT cache entry wrong (env ignored?):', rootLine);
    fail++;
  }
}
if (cfg !== 0) {
  console.error('cmake configure failed');
  fail++;
}

process.exit(fail ? 1 : 0);
