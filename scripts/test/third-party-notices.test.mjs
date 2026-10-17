// Every package whose wasm statically links third-party code ships a
// THIRD-PARTY-NOTICES.md that names each linked component with its licence
// (homescoop#684 Emscripten command packages, #713 wasix-libc; #726, #729,
// #743, #797 for the py-* side modules).
//
// What a package links is read from metadata, not guessed:
//   - package.json slicc.abi "emscripten" + a wasm command: the Emscripten
//     runtime (Emscripten, musl, libc++, compiler-rt).
//   - built with the pinned wasix-sysroot toolchain (build script runs
//     scripts/install-wasixcc.sh) + a wasm command: wasix-libc.
//   - recipe dependencies.build / dependencies.host (the dev packages it
//     links) and recipe sources: (vendored tarballs), minus NOT_LINKED.
//   - recipe notices.links (explicit list), minus recipe notices.not_linked
//     (a map: component -> why it isn't linked).
//   - cert/meta.json "notices" (names; scripts/browser-cert/notices.mjs checks
//     the installed file's licence texts), which replaces DECLARED below,
//     the issue-sourced list for packages that don't declare them yet.
//
// A component counts as named when a homescoop_notice heading in the
// package's build scripts (and the shared drivers they source) names it (or homescoop_notice_emscripten /
// homescoop_notice_wasix_libc is called), and package.json files[] ships
// THIRD-PARTY-NOTICES.md. build.sh writes the file at build time, so this
// is a check of what the next build ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Today's violations: "<package> <component> #<issue>", one per line.
// Shrink this list; never add to it without an issue.
const ALLOWLIST = `
cmake Emscripten #844
cmake files #844
wasm-binaryen Emscripten #844
wasm-binaryen files #844
wasm-clang Emscripten #844
wasm-clang files #844
py-contourpy pybind11 #797
py-contourpy files #797
py-kiwisolver cppy #815
py-kiwisolver files #815
py-matplotlib freetype #743
py-matplotlib Qhull #743
py-matplotlib Agg #743
py-matplotlib BaKoMa #743
py-matplotlib files #743
py-pandas ujson #729
py-pandas klib #729
py-pandas files #729
py-scipy OpenBLAS #729
py-scipy libf2c #729
py-scipy files #729
`;

// Bundled code no metadata names yet (from the issues). A package's
// cert/meta.json "notices" list, once it has one, replaces its entry here.
const DECLARED = {
  'py-numpy': ['OpenBLAS'], // #726
  'py-scipy': ['OpenBLAS', 'libf2c'], // #729
  'py-pandas': ['ujson', 'klib'], // #729
  'py-matplotlib': ['Qhull', 'Agg', 'BaKoMa'], // #743
  'py-contourpy': ['pybind11'], // #797
};

// Dependencies and sources that are not linked into the shipped wasm.
const NOT_LINKED = {
  '*': {
    'wasix-python': 'the interpreter py-* side modules load into; its own notices cover it',
    'py-numpy': 'build-time headers and Python API; py-numpy ships its own notices',
    wasix_python: 'headers to build side modules against',
    cpython: 'headers to build side modules against',
    cython: 'build tool: Cython-generated C carries no licence obligation',
    cxxrt: 'libc++ runtime, Apache-2.0 WITH LLVM-exception (no notice for compiled code)',
    meson: 'build tool',
    perl_cross: 'cross-build system',
    wasix_libc: 'the sysroot itself',
  },
  'py-pillow': { wasix_zlib: "headers only: zlib is python.wasm's (THIRD-PARTY-NOTICES.md says so)" },
  zip: { unzip: 'Info-ZIP unzip ships as its own command; its licence is staged with homescoop_stage_licenses' },
  'wasix-websocat': { licence: "websocat's own LICENSE text" },
};

function readRecipe(name) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const depName = (d) => String(d).replace(/^@ai-ecoverse\//, '').replace(/@[^@]*$/, '');
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.startsWith('[') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Aliases a heading may use for a component: full name, then without wasm-/wasix- prefix. */
function aliases(c) {
  const out = new Set([norm(c)]);
  const bare = c.replace(/^(wasm|wasix)[-_]/, '');
  out.add(norm(bare));
  return [...out].filter(Boolean);
}

// The package's own *.sh, plus the shared scripts/*.sh build drivers they
// source (build-gnu-cli.sh). build-common.sh and notices-common.sh only
// define the helpers: their template headings don't count, a call does.
const HELPERS = new Set(['build-common.sh', 'notices-common.sh']);
function scriptsOf(name) {
  const dir = join(root, 'packages', name);
  const lines = readdirSync(dir)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
    .split('\n');
  const shared = new Set();
  for (const l of lines) {
    const m = l.match(/^\s*(?:source|\.)\s+"?\$\{?(?:ROOT|HOMESCOOP_ROOT)\}?\/scripts\/([\w.-]+\.sh)"?/);
    if (m && !HELPERS.has(m[1])) shared.add(m[1]);
  }
  for (const f of shared) lines.push(...readFileSync(join(root, 'scripts', f), 'utf8').split('\n'));
  return lines;
}

/** Pure: the violations for one package, given its metadata and build script lines. */
export function noticeViolations({ name, recipe, pkg, lines: all, certNotices }) {
  const lines = all.filter((l) => !/^\s*#/.test(l));
  const hasWasmCommand = Object.values(pkg.slicc?.commands || {}).some((c) => c && c.wasm);
  const deps = [...asList(recipe.dependencies?.build), ...asList(recipe.dependencies?.host)].map(depName);
  const notLinked = { ...NOT_LINKED['*'], ...(NOT_LINKED[name] || {}), ...(recipe.notices?.not_linked || {}) };
  const required = new Set();
  if (hasWasmCommand && pkg.slicc?.abi === 'emscripten') required.add('Emscripten');
  if (hasWasmCommand && lines.some((l) => /install-wasixcc\.sh/.test(l))) required.add('wasix-libc');
  const sideModules = deps.includes('wasix-python');
  if (hasWasmCommand || sideModules || recipe.notices || certNotices?.length) {
    for (const d of deps) required.add(d);
    for (const s of Object.keys(recipe.sources || {})) required.add(s);
    for (const l of asList(recipe.notices?.links)) required.add(l);
    for (const l of certNotices?.length ? certNotices : DECLARED[name] || []) required.add(l);
  }
  for (const k of Object.keys(notLinked)) required.delete(k);
  if (!required.size) return [];

  const headings = lines
    .map((l) => l.match(/homescoop_notice\s+"([^"]*)"/)?.[1])
    .filter(Boolean)
    .map(norm);
  const calls = (fn) => lines.some((l) => new RegExp(`(^|[\\s;&|])${fn}(\\s|$)`).test(l));
  const named = (c) => {
    if (c === 'Emscripten' && calls('homescoop_notice_emscripten')) return true;
    if (c === 'wasix-libc' && calls('homescoop_notice_wasix_libc')) return true;
    return aliases(c).some((a) => headings.some((h) => h.includes(a)));
  };
  const out = [...required].filter((c) => !named(c));
  if (!asList(pkg.files).includes('THIRD-PARTY-NOTICES.md')) out.push('files');
  return out;
}

function allPackages() {
  const res = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const pj = join(root, 'packages', name, 'package', 'package.json');
    if (!existsSync(join(root, 'packages', name, 'recipe.yaml')) || !existsSync(pj)) continue;
    const recipe = readRecipe(name);
    if (recipe.builder === 'retired') continue;
    const meta = join(root, 'packages', name, 'cert', 'meta.json');
    const certNotices = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')).notices || []).map((n) => n.name) : [];
    res.push({ name, recipe, pkg: JSON.parse(readFileSync(pj, 'utf8')), lines: scriptsOf(name), certNotices });
  }
  return res;
}

function parseAllowlist() {
  const m = new Map();
  for (const line of ALLOWLIST.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [pkg, comp, issue, ...rest] = line.split(/\s+/);
    assert.ok(pkg && comp && /^#\d+$/.test(issue || '') && !rest.length, `allowlist line needs "<package> <component> #<issue>": ${line}`);
    m.set(`${pkg} ${comp}`, issue);
  }
  return m;
}

test('every package that links third-party code names it in THIRD-PARTY-NOTICES.md', () => {
  const allow = parseAllowlist();
  const found = new Set();
  const errors = [];
  for (const p of allPackages()) {
    for (const c of noticeViolations(p)) {
      const key = `${p.name} ${c}`;
      found.add(key);
      if (allow.has(key)) continue;
      errors.push(
        c === 'files'
          ? `${p.name}: package.json files[] must ship THIRD-PARTY-NOTICES.md`
          : `${p.name}: THIRD-PARTY-NOTICES.md must name ${c} with its licence (homescoop_notice "${c} …" in build.sh${c === 'Emscripten' ? ', or homescoop_notice_emscripten' : c === 'wasix-libc' ? ', or homescoop_notice_wasix_libc' : ''})`,
      );
    }
  }
  for (const [key, issue] of allow) {
    if (!found.has(key)) errors.push(`allowlist entry "${key} ${issue}" is fixed (or stale): remove it`);
  }
  assert.deepEqual(errors, []);
});

test('the rules: Emscripten runtime, wasix-libc, linked dev packages, vendored sources', () => {
  const base = { name: 't', recipe: { dependencies: {} }, pkg: { slicc: { abi: 'emscripten', commands: { t: { wasm: 'bin/t.wasm' } } }, files: ['LICENSE'] }, lines: [] };
  assert.deepEqual(noticeViolations(base), ['Emscripten', 'files']);
  const ok = { ...base, pkg: { ...base.pkg, files: ['LICENSE', 'THIRD-PARTY-NOTICES.md'] }, lines: ['homescoop_notices_begin "x"', 'homescoop_notice_emscripten'] };
  assert.deepEqual(noticeViolations(ok), []);
  // A comment doesn't count.
  assert.deepEqual(noticeViolations({ ...ok, lines: ['  # homescoop_notice_emscripten'] }), ['Emscripten']);
  // Linked dev package and vendored source must be named in a heading.
  const linked = { ...ok, recipe: { dependencies: { build: ['@ai-ecoverse/wasm-zlib@1.3.1-2'] }, sources: { libjpeg_turbo: {}, meson: {} } } };
  assert.deepEqual(noticeViolations(linked), ['wasm-zlib', 'libjpeg_turbo']);
  assert.deepEqual(noticeViolations({ ...linked, lines: [...ok.lines, 'homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" a -', 'WORK="$B" homescoop_notice "libjpeg-turbo 3.1.2" b -'] }), []);
  // wasix: the install-wasixcc toolchain means wasix-libc is linked.
  const wasix = { name: 'w', recipe: { dependencies: {} }, pkg: { slicc: { abi: 'wasi', commands: { w: { wasm: 'bin/w.wasm' } } }, files: ['THIRD-PARTY-NOTICES.md'] }, lines: ['eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh")"'] };
  assert.deepEqual(noticeViolations(wasix), ['wasix-libc']);
  assert.deepEqual(noticeViolations({ ...wasix, lines: [...wasix.lines, 'homescoop_notice_wasix_libc'] }), []);
  // A static library package (no wasm command) links nothing itself.
  assert.deepEqual(noticeViolations({ ...base, pkg: { files: [] }, recipe: { dependencies: { build: ['@ai-ecoverse/wasm-zlib@1'] } } }), []);
  // cert/meta.json notices names are required too, and replace DECLARED.
  assert.deepEqual(noticeViolations({ ...ok, pkg: { files: ['THIRD-PARTY-NOTICES.md'] }, certNotices: ['pybind11'] }), ['pybind11']);
  assert.deepEqual(noticeViolations({ ...ok, name: 'py-numpy', recipe: { dependencies: { build: ['wasix-python'] } }, certNotices: ['OpenBLAS 0.3.28'] }), ['OpenBLAS 0.3.28']);
  // Recipe notices.links / notices.not_linked.
  assert.deepEqual(noticeViolations({ ...ok, recipe: { dependencies: {}, sources: { gsfonts: {} }, notices: { links: ['Qhull'], not_linked: { gsfonts: 'not shipped' } } } }), ['Qhull']);
});
