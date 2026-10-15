#!/usr/bin/env node
/**
 * THIRD-PARTY-NOTICES.md sections for the crates a Rust wasm statically links.
 *
 *   node scripts/rust-crate-notices.mjs <metadata.json> <cargo-tree.txt>
 *
 * cargo-tree.txt is `cargo tree --target <t> -e normal --prefix none [-p pkg]`
 * of the build's source tree: the crates cargo compiles into that package for
 * that target, with its features (a workspace's `cargo metadata` resolve
 * unifies the features of every member, so it lists crates the wasm does not
 * link). metadata.json (`cargo metadata --format-version 1`, same tree, same
 * vendored sources) gives each crate's licence expression and source
 * directory. Local path crates (the package itself, homescoop's crates/) are
 * skipped. Each crate's licence files come from its unpacked source next to
 * its Cargo.toml. A crate that ships none (servo's selectors) gets the text of
 * its declared licence from scripts/licence-texts/<SPDX>.txt when that is a
 * single SPDX id; anything else is an error. Every section names the crate's
 * source (MPL-2.0 3.2).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeCrates } from './rust-crate-notices-lib.mjs';

const texts = join(dirname(fileURLToPath(import.meta.url)), 'licence-texts');
const [metaPath, treePath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const want = treeCrates(readFileSync(treePath, 'utf8'));
const byKey = new Map(meta.packages.filter((p) => p.source).map((p) => [`${p.name} ${p.version}`, p]));
const crates = [...want]
  .map((k) => {
    const p = byKey.get(k);
    if (!p) throw new Error(`cargo tree lists ${k}, cargo metadata has no registry/git package for it`);
    return p;
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const LICENCE = /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i;
const out = [];
for (const p of crates) {
  const dir = dirname(p.manifest_path);
  const files = readdirSync(dir).filter((f) => LICENCE.test(f)).sort();
  out.push(`\n## ${p.name} ${p.version} (${p.license})\n`);
  if (p.source.startsWith('registry+')) out.push(`\nSource: https://crates.io/crates/${p.name}/${p.version}\n`);
  else out.push(`\nSource: ${p.source.replace(/^git\+/, '')}\n`);
  if (!files.length) {
    const spdx = join(texts, `${p.license}.txt`);
    if (!/^[A-Za-z0-9.-]+$/.test(p.license ?? '') || !existsSync(spdx)) {
      throw new Error(`no licence file in ${p.name} ${p.version} (${dir}), and no scripts/licence-texts/${p.license}.txt`);
    }
    out.push(`\nThe crate ships no licence file; this is the text of its declared licence, ${p.license}.\n`);
    out.push(`\n\`\`\`text\n${readFileSync(spdx, 'utf8').trim()}\n\`\`\`\n`);
    continue;
  }
  for (const f of files) out.push(`\n\`\`\`text\n${readFileSync(join(dir, f), 'utf8').trim()}\n\`\`\`\n`);
}
process.stdout.write(out.join(''));
