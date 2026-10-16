// Cert coverage lint (homescoop#426, #519, #772): every recipe that ships
// has a committed cert/, every cert/meta.json checklist item points at
// something that checks it, and a command package's cert boots the kernel
// with users enforce.
//
// Each rule has an allowlist of today's violations, one per line, each with
// the issue that tracks it. A new violation fails; so does an allowlist
// entry that no longer is one (delete the line when you fix it), so the
// lists only get shorter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST_HARNESSES = ['host-node', 'host-smoke'];

// Recipes that ship but have no cert/ at all.
const NO_CERT = [
  'cmake', // #426
  'emscripten-cache', // #426
  'freetype', // #426
  'gmake', // #426
  'lcms2', // #426
  'libiconv', // #426
  'libjpeg-turbo', // #426
  'libpng', // #426
  'libtiff', // #426
  'libwebp', // #426
  'libxml2', // #426
  'openjpeg', // #426
  'zlib', // #426
];

// "<recipe>: <checklist item>" that no spec, ci command or named file checks.
const UNCOVERED = [
  'xxd: --version / -v', // #519
];

// Command packages whose cert/meta.json has no "users": "enforce".
const NO_USERS_ENFORCE = [
  'bash', // #819
  'binutils', // #819
  'bzip2', // #819
  'diffutils', // #819
  'file', // #819
  'gawk', // #819
  'git', // #819
  'grep', // #819
  'gzip', // #819
  'imagemagick', // #819
  'imagemagick-heif', // #819
  'jq', // #819
  'less', // #819
  'libheif', // #819
  'mount', // #819
  'nano', // #819
  'ncurses-utils', // #819
  'patch', // #819
  'poppler', // #819
  'procps', // #819
  'sed', // #819
  'sqlite3', // #819
  'wasi-biome', // #819
  'wasi-dig', // #819
  'wasi-fnox', // #819
  'wasi-ripgrep', // #819
  'wasi-typescript', // #819
  'wasi-uv', // #772
  'wasix-gnupg', // #819
  'wasix-perl', // #819
  'wasix-python', // #819
  'wasix-ruby', // #819
  'xxd', // #819
  'xz', // #819
];

function recipes(dir = root) {
  return readdirSync(join(dir, 'packages'))
    .filter((p) => existsSync(join(dir, 'packages', p, 'recipe.yaml')))
    .filter((p) => !/^builder:\s*retired\s*$/m.test(readFileSync(join(dir, 'packages', p, 'recipe.yaml'), 'utf8')))
    .sort();
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function walk(d, out = []) {
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs|sh|py|c)$/.test(e)) out.push(p);
  }
  return out;
}

// Spec sources: everything under cert/, the files the ci commands run, and
// every file those import by relative path (cert/lib helpers, another
// recipe's cert/lib).
function corpus(pkg, meta, dir) {
  const files = new Set(walk(join(dir, 'packages', pkg, 'cert')));
  for (const cmd of meta.ci || []) {
    for (const f of cmd.match(/[\w./-]+\.(?:mjs|js|sh|py|c)\b/g) || []) {
      if (existsSync(join(dir, f))) files.add(join(dir, f));
    }
  }
  const queue = [...files];
  while (queue.length) {
    const f = queue.pop();
    if (!/\.m?js$/.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const t = resolve(dirname(f), m[1]);
      if (existsSync(t) && !files.has(t)) {
        files.add(t);
        queue.push(t);
      }
    }
  }
  return [...files].map((f) => readFileSync(f, 'utf8')).join('\n');
}

// Files an item names as its evidence (run-modes.mjs, check-slicc-cred.mjs,
// test/*.test.mjs, relink.sh). Prose names sources (masterdump.c) and paths
// inside the kernel (dist/out.js) the same way, so only one kind is checked
// for existence: this recipe's own cert/<spec>.mjs (not "py-kiwisolver's
// cert/matplotlib.mjs").
function namedFiles(item) {
  return [...item.matchAll(/(?<![\w/.-])([\w./*-]+\.(?:mjs|js|sh|py|c))\b/g)].map((m) => m[1]);
}

function namedSpecs(item) {
  return [...item.matchAll(/(?<!'s )(?<![\w/.-])cert\/([\w./-]+\.mjs)\b/g)].map((m) => m[1]);
}

// Command-line flags an item names (-v, --version, -i.bak is -i).
function flags(item) {
  return [...item.matchAll(/(?:^|[\s(/,`'"])(--?[a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]);
}

/**
 * An item that names one of this recipe's cert/<spec>.mjs is covered when
 * that spec exists. Otherwise it is covered when it names a file as its
 * evidence, or when it names command-line flags and the spec sources use at
 * least one of them. An item with neither is prose a lint cannot check, and
 * is left alone.
 */
export function uncoveredItems(pkg, meta, dir = root) {
  const text = corpus(pkg, meta, dir);
  const out = [];
  for (const item of meta.checklist || []) {
    if (typeof item !== 'string') continue;
    const missing = namedSpecs(item).filter((f) => !existsSync(join(dir, 'packages', pkg, 'cert', f)));
    if (missing.length) {
      out.push({ item, why: `names cert/${missing.join(', cert/')}, which does not exist` });
      continue;
    }
    if (namedFiles(item).length) continue;
    const fl = flags(item);
    if (fl.length && !fl.some((f) => text.includes(f))) {
      out.push({ item, why: `no spec uses ${fl.join(' or ')}` });
    }
  }
  return out;
}

/** A package that ships slicc commands: the kernel runs it with its users' credentials. */
export function needsUsersEnforce(pkg, meta, dir = root) {
  const manifest = readJson(join(dir, 'packages', pkg, 'package', 'package.json'));
  const commands = Object.keys(manifest?.slicc?.commands || {}).length;
  if (!commands || !meta) return false;
  if (HOST_HARNESSES.includes(meta.harness)) return false;
  return true;
}

function sameSet(actual, allow, what) {
  const fresh = actual.filter((a) => !allow.includes(a.key));
  const stale = allow.filter((a) => !actual.some((x) => x.key === a));
  assert.deepEqual(
    fresh.map((f) => f.msg),
    [],
    `${what}: new violation(s); fix them, or allowlist each one with its issue in scripts/test/cert-coverage.test.mjs`,
  );
  assert.deepEqual(stale, [], `${what}: allowlisted but fixed; delete these lines from scripts/test/cert-coverage.test.mjs`);
}

test('every recipe that ships has a committed cert/ (#426)', () => {
  const bad = recipes()
    .filter((p) => !existsSync(join(root, 'packages', p, 'cert', 'meta.json')))
    .map((p) => ({ key: p, msg: `packages/${p}: no cert/meta.json (a link/import smoke, one real-use spec and a NEGATIVE.md)` }));
  sameSet(bad, NO_CERT, 'cert/');
});

test('every cert/meta.json checklist item is checked by a spec (#519)', () => {
  const bad = [];
  for (const p of recipes()) {
    const meta = readJson(join(root, 'packages', p, 'cert', 'meta.json'));
    if (!meta) continue;
    for (const { item, why } of uncoveredItems(p, meta)) {
      bad.push({ key: `${p}: ${item}`, msg: `packages/${p}/cert/meta.json: checklist item ${JSON.stringify(item.slice(0, 120))} ${why}` });
    }
  }
  sameSet(bad, UNCOVERED, 'checklist');
});

test('a command package\'s cert boots the kernel with users enforce (#772)', () => {
  const bad = [];
  for (const p of recipes()) {
    const meta = readJson(join(root, 'packages', p, 'cert', 'meta.json'));
    if (!needsUsersEnforce(p, meta)) continue;
    if (meta.users !== 'enforce') {
      bad.push({ key: p, msg: `packages/${p}/cert/meta.json: users is ${JSON.stringify(meta.users ?? null)}, not "enforce", but the package ships slicc commands` });
    }
  }
  sameSet(bad, NO_USERS_ENFORCE, 'users');
});

test('the lint finds what it should', () => {
  const meta = { checklist: ['xxd | xxd -r round trip', '--version / -v', 'cert/nope.mjs: a spec', "py-kiwisolver's cert/matplotlib.mjs runs"] };
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-cert-coverage-'));
  try {
    mkdirSync(join(dir, 'packages', 'x', 'cert'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'x', 'cert', 'roundtrip.mjs'), "run(['xxd', '-r', 'f'])\n");
    const got = uncoveredItems('x', meta, dir).map((u) => u.item);
    assert.deepEqual(got, ['--version / -v', 'cert/nope.mjs: a spec']);
    writeFileSync(join(dir, 'packages', 'x', 'cert', 'version.mjs'), "run(['xxd', '-v'])\n");
    assert.deepEqual(uncoveredItems('x', meta, dir).map((u) => u.item), ['cert/nope.mjs: a spec']);
    mkdirSync(join(dir, 'packages', 'x', 'package'));
    const manifest = (commands) => writeFileSync(join(dir, 'packages', 'x', 'package', 'package.json'), JSON.stringify({ slicc: { abi: 'wasi', commands } }));
    manifest({ x: { wasm: 'x.wasm' } });
    assert.equal(needsUsersEnforce('x', { harness: 'slicc-kernel' }, dir), true);
    assert.equal(needsUsersEnforce('x', { harness: 'host-node' }, dir), false);
    manifest({});
    assert.equal(needsUsersEnforce('x', { harness: 'slicc-kernel' }, dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
