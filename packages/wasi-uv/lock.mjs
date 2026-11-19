import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEP = '\n[[package]]\n';
const pkgDir = fileURLToPath(new URL('.', import.meta.url));

const field = (block, key) => new RegExp(`^${key} = "([^"]*)"$`, 'm').exec(block)?.[1];

function parse (text) {
  const [head, ...blocks] = text.split(SEP);
  if (!blocks.length) throw new Error('Cargo.lock has no [[package]] entries');
  return { head, blocks };
}

const id = (block) => `${field(block, 'name')} ${field(block, 'version')}`;

function find (blocks, key) {
  const hits = blocks.filter((b) => (key.includes(' ') ? id(b) === key : field(b, 'name') === key));
  if (hits.length !== 1) throw new Error(`Cargo.lock has ${hits.length} ${key} entries, want 1${hits.length > 1 ? ' (name a version: "<name> <version>")' : ''}`);
  return blocks.indexOf(hits[0]);
}

function reference (blocks, key) {
  const b = blocks[find(blocks, key)];
  const name = field(b, 'name');
  return blocks.filter((x) => field(x, 'name') === name).length > 1 ? id(b) : name;
}

function compareDeps (a, b) {
  const [an, ...ar] = a.split(' ');
  const [bn, ...br] = b.split(' ');
  if (an !== bn) return an < bn ? -1 : 1;
  const av = ar.join(' ');
  const bv = br.join(' ');
  return av === bv ? 0 : av < bv ? -1 : 1;
}

function depsOf (block) {
  const m = /^dependencies = \[\n((?: "[^"]*",\n)*)\]\n/m.exec(block);
  return m ? m[1].split('\n').filter(Boolean).map((l) => /^ "(.*)",$/.exec(l)[1]) : [];
}

function withDeps (block, deps) {
  const list = `dependencies = [\n${deps.map((d) => ` "${d}",\n`).join('')}]\n`;
  return /^dependencies = \[/m.test(block) ? block.replace(/^dependencies = \[\n(?: "[^"]*",\n)*\]\n/m, list) : `${block}${list}`;
}

export function editLock (text, { unlock = [], dependencies = {}, packages = [] }) {
  const { head, blocks } = parse(text);
  for (const [name, version] of unlock) {
    const i = find(blocks, `${name} ${version}`);
    if (!field(blocks[i], 'source') || !field(blocks[i], 'checksum')) throw new Error(`Cargo.lock's ${name} ${version} has no registry source and checksum to drop`);
    blocks[i] = blocks[i].split('\n').filter((l) => !/^(source|checksum) = /.test(l)).join('\n');
  }
  for (const p of packages) {
    if (blocks.some((b) => field(b, 'name') === p.name)) throw new Error(`Cargo.lock already has ${p.name}; drop it from lock.json's packages`);
    let block = `name = "${p.name}"\nversion = "${p.version}"\n`;
    if (p.source) block += `source = "${p.source}"\nchecksum = "${p.checksum}"\n`;
    const at = blocks.findIndex((b) => field(b, 'name') > p.name);
    blocks.splice(at < 0 ? blocks.length : at, 0, block);
  }
  for (const p of packages) {
    if (!p.dependencies?.length) continue;
    const i = find(blocks, p.name);
    blocks[i] = withDeps(blocks[i], p.dependencies.map((d) => reference(blocks, d)).sort(compareDeps));
  }
  let added = 0;
  for (const [target, wanted] of Object.entries(dependencies)) {
    const i = find(blocks, target);
    const deps = depsOf(blocks[i]);
    for (const d of wanted) {
      const ref = reference(blocks, d);
      if (deps.includes(ref)) throw new Error(`Cargo.lock's ${target} already depends on ${ref}; drop it from lock.json`);
      deps.push(ref);
      added++;
    }
    blocks[i] = withDeps(blocks[i], deps.sort(compareDeps));
  }
  return { text: `${head}${SEP}${blocks.join(SEP)}`, unlocked: unlock.length, added, packages: packages.length };
}

export function lockEdits (dir = pkgDir) {
  const spec = JSON.parse(readFileSync(new URL('lock.json', pathToFileURL(`${dir}/`)), 'utf8'));
  const unlock = readdirSync(new URL('crates/', pathToFileURL(`${dir}/`)))
    .filter((f) => f.endsWith('.patch'))
    .sort()
    .map((f) => {
      const m = /^(.+)-(\d+\.\d+\.\d+)\.patch$/.exec(f);
      if (!m) throw new Error(`crates/${f} is not <name>-<version>.patch`);
      return [m[1], m[2]];
    });
  return { unlock, dependencies: spec.dependencies, packages: spec.packages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node lock.mjs <uv-src>/Cargo.lock');
    process.exit(2);
  }
  try {
    const r = editLock(readFileSync(file, 'utf8'), lockEdits());
    writeFileSync(file, r.text);
    console.log(`== wasi-uv: Cargo.lock: PASS unlocked ${r.unlocked} crates, added ${r.added} dependencies and ${r.packages} packages`);
  } catch (err) {
    console.error(`wasi-uv lock.mjs: ${err.message}`);
    process.exit(1);
  }
}
