#!/usr/bin/env node
/**
 * List homescoop package names touched between two git refs (or from a file list).
 *
 *   node scripts/list-touched-packages.mjs --base origin/main --head HEAD
 *   node scripts/list-touched-packages.mjs --base A --head B --publishable
 *   node scripts/list-touched-packages.mjs --files <(git diff --name-only …)
 *   echo 'packages/zlib/recipe.yaml' | node scripts/list-touched-packages.mjs --stdin
 *
 * --publishable: only recipe.yaml or package/ (not build.sh, patches, docs).
 * ladder-merge uses that so a tooling-only change cannot dispatch publish.
 *
 * Prints one package name per line. Exits 0 even when empty (caller decides).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  /** @type {{ base?: string, head?: string, files?: string, stdin: boolean, json: boolean, publishable: boolean }} */
  const out = { stdin: false, json: false, publishable: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--head') out.head = argv[++i];
    else if (a === '--files') out.files = argv[++i];
    else if (a === '--stdin') out.stdin = true;
    else if (a === '--json') out.json = true;
    else if (a === '--publishable') out.publishable = true;
    else {
      console.error(
        'usage: list-touched-packages.mjs (--base <ref> --head <ref>) | --files <path> | --stdin [--json] [--publishable]'
      );
      process.exit(2);
    }
  }
  return out;
}

/** recipe.yaml or the npm package tree — not build.sh / patches / PRESTAGE. */
function isPublishTrigger(norm) {
  return (
    /^packages\/[^/]+\/recipe\.yaml$/.test(norm) ||
    /^packages\/[^/]+\/package(?:\/|$)/.test(norm)
  );
}

export function globRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[\\^$.+()|{}[\]]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function readRecipe(name, args, dir = root) {
  const r = spawnSync('node', [join(dir, 'scripts/read-recipe.mjs'), name, ...args], {
    encoding: 'utf8',
    cwd: dir,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `read-recipe.mjs ${name} failed`);
    process.exit(1);
  }
  return (r.stdout || '').trim();
}

export const TOOLCHAINS = [
  {
    name: 'emscripten',
    uses: /\bem(?:cc|configure|make|cmake|ar|ranlib)\b|\bem\+\+(?![\w+])|\bhomescoop_(?:slicc|em)_/,
    inputs: ['scripts/install-emsdk.sh', 'scripts/emsdk-patches/**', 'shims/slicc/*.c', 'shims/slicc/*.h', 'shims/slicc/*.js'],
  },
  { name: 'binaryen', uses: /\bhomescoop_wasm_opt\b/, inputs: ['scripts/install-emsdk.sh'] },
  { name: 'wasixcc', uses: /\binstall-wasixcc\.sh\b/, inputs: ['scripts/install-wasixcc.sh'] },
  { name: 'rust', uses: /\binstall-rust\.sh\b/, inputs: ['scripts/install-rust.sh'] },
  { name: 'go', uses: /\binstall-go\.sh\b/, inputs: ['scripts/install-go.sh'] },
  { name: 'wasi-sdk', uses: /\binstall-wasi-sdk\.sh\b/, inputs: ['scripts/install-wasi-sdk.sh'] },
];

const SHARED = new Set(['scripts/build-common.sh', 'scripts/host-run.sh']);

export const OUTSIDE_BUILDS = new Map([
  ['cmake', '#859: relinks prebuilt objects from ../slicc-emscripten'],
  ['emscripten-cache', '#859: copies the ../slicc-emscripten cache tree'],
]);

function code(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s#\s.*$/, ''))
    .join('\n');
}

export function buildScripts(name, dir = root) {
  const own = join(dir, 'packages', name);
  if (!existsSync(join(own, 'build.sh'))) return [];
  const queue = readdirSync(own)
    .filter((f) => /\.(?:sh|bash)$/.test(f))
    .sort()
    .map((f) => `packages/${name}/${f}`);
  const seen = new Set(queue);
  const out = [];
  while (queue.length) {
    const path = queue.shift();
    const text = code(readFileSync(join(dir, path), 'utf8'));
    out.push({ path, text });
    for (const m of text.matchAll(/\bscripts\/([A-Za-z0-9._-]+\.sh)\b/g)) {
      const ref = `scripts/${m[1]}`;
      if (seen.has(ref) || SHARED.has(ref) || !existsSync(join(dir, ref))) continue;
      seen.add(ref);
      queue.push(ref);
    }
  }
  return out;
}

export function toolchainInputs(name, dir = root, recipe = null) {
  const r = recipe || JSON.parse(readRecipe(name, ['--json'], dir));
  if ((r.builder || 'slicc') !== 'host') return [];
  if (r.repack && typeof r.repack === 'object' && r.repack.from) return [];
  if (OUTSIDE_BUILDS.has(name)) return [];
  const scripts = buildScripts(name, dir);
  const globs = [];
  for (const t of TOOLCHAINS) {
    if (scripts.some((s) => t.uses.test(s.text))) globs.push(...t.inputs);
  }
  for (const s of scripts) if (s.path.startsWith('scripts/')) globs.push(s.path);
  return [...new Set(globs)];
}

function recipeInputs() {
  const out = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const file = join(root, 'packages', name, 'recipe.yaml');
    if (!existsSync(file)) continue;
    const recipe = JSON.parse(readRecipe(name, ['--json']));
    const globs = /^inputs:/m.test(readFileSync(file, 'utf8')) ? recipe.inputs : [];
    if (!Array.isArray(globs) || globs.some((g) => typeof g !== 'string' || !g)) {
      console.error(`packages/${name}/recipe.yaml: inputs must be a list of path globs`);
      process.exit(1);
    }
    const all = [...globs, ...toolchainInputs(name, root, recipe)];
    if (all.length) out.push({ name, res: all.map(globRegExp) });
  }
  return out;
}

function packagesFromPaths(paths, publishable) {
  const names = new Set();
  const inputs = publishable ? [] : recipeInputs();
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (publishable && !isPublishTrigger(norm)) continue;
    const m = norm.match(/^packages\/([^/]+)\//);
    if (m) names.add(m[1]);
    for (const { name, res } of inputs) {
      if (res.some((re) => re.test(norm))) names.add(name);
    }
  }
  const set = new Set();
  for (const name of names) {
    if (!existsSync(join(root, 'packages', name, 'recipe.yaml'))) continue;
    if (readRecipe(name, ['--field', 'builder']) === 'retired') continue;
    set.add(name);
  }
  return [...set].sort();
}

function gitDiffNames(base, head) {
  const r = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || 'git diff failed');
    process.exit(1);
  }
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv);
  let paths = [];
  if (args.stdin) {
    paths = readFileSync(0, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else if (args.files) {
    paths = readFileSync(args.files, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else if (args.base && args.head) {
    paths = gitDiffNames(args.base, args.head);
  } else {
    console.error('need --base/--head, --files, or --stdin');
    process.exit(2);
  }

  const pkgs = packagesFromPaths(paths, args.publishable);
  if (args.json) {
    console.log(JSON.stringify(pkgs));
  } else {
    for (const p of pkgs) console.log(p);
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) main();
