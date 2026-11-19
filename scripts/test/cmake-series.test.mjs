import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recipeVersion, seriesOf } from '../../packages/cmake/cert/lib/version.mjs';

const dir = new URL('../../packages/cmake/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, dir), 'utf8');
const pkg = JSON.parse(read('package/package.json'));
const readme = read('package/README.md');
const prestage = read('PRESTAGE.md');
const smoke = readFileSync(new URL('../smoke-cmake.mjs', import.meta.url), 'utf8');
const libuvPatch = read('libuv-emscripten.patch');

export function manifestRootErrors (manifest, version) {
  const want = `\${package}/share/cmake-${seriesOf(version)}`;
  const errors = [];
  const roots = {
    'slicc.env.CMAKE_ROOT': manifest.slicc?.env?.CMAKE_ROOT,
    'slicc.commands.cmake.env.CMAKE_ROOT': manifest.slicc?.commands?.cmake?.env?.CMAKE_ROOT,
  };
  for (const [key, value] of Object.entries(roots)) {
    if (value !== want) errors.push(`${key} is ${value}, but recipe.yaml's ${version} stages its modules in ${want}`);
  }
  return errors;
}

export function readmeRootErrors (text, version) {
  const series = seriesOf(version);
  const errors = [];
  if (!text.includes(`\`\${package}/share/cmake-${series}\``)) errors.push(`README.md does not name the manifest default \${package}/share/cmake-${series}`);
  for (const m of text.matchAll(/share\/cmake-(\d+\.\d+)\b/g)) {
    if (m[1] !== series) errors.push(`README.md names share/cmake-${m[1]}, not ${series}`);
  }
  return errors;
}

export function pinnedSeriesErrors (file, text) {
  const errors = [];
  for (const m of text.matchAll(/share\/cmake-\d+\.\d+|\bcmake \d+\.\d+\.\d+\b/gi)) {
    errors.push(`${file} names ${m[0]}; derive it from recipe.yaml or package.json`);
  }
  return errors;
}

export function smokeRootErrors (text) {
  const errors = pinnedSeriesErrors('smoke-cmake.mjs', text);
  if (!text.includes('.slicc.env.CMAKE_ROOT')) errors.push('smoke-cmake.mjs does not read package.json slicc.env.CMAKE_ROOT');
  return errors;
}

const PROBE = 'uv_once(&posix_spawn_init_once, uv__spawn_init_posix_spawn);';

export function spawnHunkErrors (patch) {
  const file = patch.split(/^(?=--- a\/)/m).find((f) => f.startsWith('--- a/Utilities/cmlibuv/src/unix/process.c\n'));
  if (!file) return ['libuv-emscripten.patch does not patch Utilities/cmlibuv/src/unix/process.c'];
  const errors = [];
  if (file.includes('UV_USE_APPLE_POSIX_SPAWN')) errors.push('process.c context names UV_USE_APPLE_POSIX_SPAWN, which cmake 4.5.0\'s libuv 1.53.0 no longer has');
  const hunk = file.split(/^(?=@@ )/m).find((h) => h.includes('\n+    child = slicc_spawn_capture(options->file,'));
  if (!hunk) return [...errors, 'no process.c hunk starts the child through slicc_spawn_capture'];
  const lines = hunk.split('\n').slice(1);
  const added = lines.map((l, i) => (l.startsWith('+') ? i : -1)).filter((i) => i >= 0);
  const context = (from, to) => lines.slice(from, to).filter((l) => l.startsWith(' ')).map((l) => l.slice(1).trim()).filter(Boolean);
  const body = lines.slice(added[0], added.at(-1) + 1);
  if (!body.every((l) => l.startsWith('+'))) errors.push('the slicc_spawn_capture block is not one run of added lines');
  const code = body.map((l) => l.slice(1).trim()).filter(Boolean);
  if (code[0] !== '#if defined(__EMSCRIPTEN__)' || code.at(-1) !== '#endif') errors.push('the slicc_spawn_capture block is not guarded by #if defined(__EMSCRIPTEN__)');
  if (!code.includes('return child;') || code.at(-3) !== 'return 0;') errors.push('the slicc_spawn_capture block does not return on every path');
  if (code.some((l) => l.includes('/*') || l.startsWith('//'))) errors.push('the slicc_spawn_capture block has a comment');
  if (context(0, added[0]).at(-1) !== 'ssize_t r;') errors.push('the slicc_spawn_capture block does not follow uv__spawn_and_init_child\'s declarations');
  const next = context(added.at(-1) + 1, lines.length)[0];
  if (next !== PROBE) errors.push(`the slicc_spawn_capture block is followed by ${next}, not libuv's posix_spawn probe ${PROBE}`);
  return errors;
}

const published445 = {
  name: '@ai-ecoverse/wasm-cmake',
  version: '4.4.5-1',
  homescoop: { recipe: 'cmake', upstream: '4.4.5' },
  slicc: {
    abi: 'emscripten',
    commands: { cmake: { glue: 'bin/cmake', wasm: 'bin/cmake.wasm', env: { CMAKE_ROOT: '${package}/share/cmake-4.4' } } },
    env: { CMAKE_ROOT: '${package}/share/cmake-4.4' },
  },
};

const readme445 = 'libcurl with Mbed TLS, so https downloads work. Honors `CMAKE_ROOT` (manifest default:\n`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.\n';
const prestage445 = 'Built in CI from the cmake 4.4.5 release tarball with emcmake from the patched emscripten 6.0.9 tree (homescoop#859 stage G)';
const smoke445 = "const runCli = join(root, 'scripts/run-wasm-cli.mjs');\nconst modules = join(pkg, 'share/cmake-4.4');\n";
const patch445 = [
  '--- a/Utilities/cmlibuv/src/unix/process.c',
  '+++ b/Utilities/cmlibuv/src/unix/process.c',
  '@@ -917,6 +927,24 @@',
  '   int exec_errorno;',
  '   ssize_t r;',
  ' ',
  '+#if defined(__EMSCRIPTEN__)',
  '+  {',
  '+    int fds[3];',
  '+    int fd;',
  '+    int child;',
  '+    for (fd = 0; fd < 3; fd++)',
  '+      fds[fd] = fd < stdio_count ? pipes[fd][1] : -1;',
  '+    child = slicc_spawn_capture(options->file, options->args,',
  '+                                options->env != NULL ? options->env : environ,',
  '+                                options->cwd, fds[0], fds[1], fds[2]);',
  '+    (void) signal_pipe; (void) status; (void) err; (void) exec_errorno; (void) r;',
  '+    if (child < 0)',
  '+      return child;',
  '+    *pid = child;',
  '+    return 0;',
  '+  }',
  '+#endif',
  '+',
  ' #if defined(UV_USE_APPLE_POSIX_SPAWN)',
  '   uv_once(&posix_spawn_init_once, uv__spawn_init_posix_spawn);',
  ' ',
  '',
].join('\n');

test('both manifest CMAKE_ROOT entries name recipe.yaml\'s series', () => {
  assert.deepEqual(manifestRootErrors(pkg, recipeVersion()), []);
  assert.equal(pkg.homescoop.upstream, recipeVersion());
});

test('NEGATIVE: 4.4.5-1\'s package.json fails for 4.5.0 and later series', () => {
  const v = recipeVersion();
  assert.notEqual(seriesOf(v), '4.4');
  const errors = manifestRootErrors(published445, v);
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], new RegExp(`slicc\\.env\\.CMAKE_ROOT is \\$\\{package\\}/share/cmake-4\\.4, but recipe\\.yaml's ${v.replaceAll('.', '\\.')}`));
  assert.match(errors[1], /^slicc\.commands\.cmake\.env\.CMAKE_ROOT is \$\{package\}\/share\/cmake-4\.4/);
  assert.deepEqual(manifestRootErrors(published445, '4.5.0').length, 2);
  assert.deepEqual(manifestRootErrors(published445, '4.4.5'), []);
});

test('NEGATIVE: one stale entry, a missing entry or a near-miss series fails', () => {
  const v = recipeVersion();
  const want = `\${package}/share/cmake-${seriesOf(v)}`;
  const only = structuredClone(pkg);
  only.slicc.commands.cmake.env.CMAKE_ROOT = '${package}/share/cmake-4.4';
  assert.deepEqual(manifestRootErrors(only, v).length, 1);
  const missing = structuredClone(pkg);
  delete missing.slicc.env;
  assert.match(manifestRootErrors(missing, v)[0], /^slicc\.env\.CMAKE_ROOT is undefined/);
  const near = structuredClone(pkg);
  near.slicc.env.CMAKE_ROOT = `${want}0`;
  assert.deepEqual(manifestRootErrors(near, v).length, 1);
  const slash = structuredClone(pkg);
  slash.slicc.env.CMAKE_ROOT = `${want}/`;
  assert.deepEqual(manifestRootErrors(slash, v).length, 1);
});

test('README.md names the manifest default for recipe.yaml\'s series and no other', () => {
  assert.deepEqual(readmeRootErrors(readme, recipeVersion()), []);
  assert.ok(readmeRootErrors(readme445, recipeVersion()).length >= 1);
  assert.deepEqual(readmeRootErrors(readme445, '4.4.5'), []);
});

test('PRESTAGE.md and smoke-cmake.mjs pin no cmake version or series', () => {
  assert.deepEqual(pinnedSeriesErrors('PRESTAGE.md', prestage), []);
  assert.deepEqual(smokeRootErrors(smoke), []);
});

test('NEGATIVE: 4.4.5-1\'s PRESTAGE.md and smoke-cmake.mjs pin 4.4.5 and share/cmake-4.4', () => {
  assert.deepEqual(pinnedSeriesErrors('PRESTAGE.md', prestage445), ['PRESTAGE.md names cmake 4.4.5; derive it from recipe.yaml or package.json']);
  const errors = smokeRootErrors(smoke445);
  assert.ok(errors.includes('smoke-cmake.mjs names share/cmake-4.4; derive it from recipe.yaml or package.json'), errors.join('\n'));
  assert.ok(errors.includes('smoke-cmake.mjs does not read package.json slicc.env.CMAKE_ROOT'), errors.join('\n'));
});

test('libuv-emscripten.patch starts children through slicc_spawn_capture before libuv 1.53\'s posix_spawn probe', () => {
  assert.deepEqual(spawnHunkErrors(libuvPatch), []);
  assert.match(libuvPatch, /^\+int slicc_spawn_capture\(const char \*file, char \*const \*argv, char \*const \*envp,$/m);
  assert.match(libuvPatch, /^\+      defined\(__EMSCRIPTEN__\) \|\| \\$/m);
  assert.match(libuvPatch, /^\+    defined\(SUNOS_NO_PTHREAD_NAME\) \|\| defined\(__EMSCRIPTEN__\)$/m);
  assert.match(libuvPatch, /^\+if\(CMAKE_SYSTEM_NAME STREQUAL "Emscripten"\)$/m);
  assert.match(libuvPatch, /^\+    src\/unix\/posix-poll\.c$/m);
});

test('NEGATIVE: 4.4.5-1\'s libuv-emscripten.patch fails the spawn hunk check', () => {
  const errors = spawnHunkErrors(patch445);
  assert.ok(errors.some((e) => e.includes('UV_USE_APPLE_POSIX_SPAWN')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('is followed by #if defined(UV_USE_APPLE_POSIX_SPAWN)')), errors.join('\n'));
});

test('NEGATIVE: a block placed after the probe, one that falls through, or no block at all fails', () => {
  const moved = libuvPatch.replace(`   ssize_t r;\n \n+#if defined(__EMSCRIPTEN__)\n+  {\n`, `   ssize_t r;\n \n   ${PROBE}\n \n+#if defined(__EMSCRIPTEN__)\n+  {\n`);
  assert.notEqual(moved, libuvPatch);
  assert.ok(spawnHunkErrors(moved).some((e) => e.includes('does not follow uv__spawn_and_init_child\'s declarations')));
  const fallthrough = libuvPatch.replace('+    *pid = child;\n+    return 0;\n', '+    *pid = child;\n');
  assert.ok(spawnHunkErrors(fallthrough).some((e) => e.includes('does not return on every path')));
  const commented = libuvPatch.replace('+    int child;\n', '+    int child;\n+    /* note */\n');
  assert.ok(spawnHunkErrors(commented).some((e) => e.includes('has a comment')));
  const none = libuvPatch.replace('+    child = slicc_spawn_capture(options->file,', '+    child = fork_and_exec(options->file,');
  assert.deepEqual(spawnHunkErrors(none), ['no process.c hunk starts the child through slicc_spawn_capture']);
  assert.deepEqual(spawnHunkErrors('--- a/Utilities/cmlibuv/CMakeLists.txt\n'), ['libuv-emscripten.patch does not patch Utilities/cmlibuv/src/unix/process.c']);
});
