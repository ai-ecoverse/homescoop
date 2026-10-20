#!/usr/bin/env node
/**
 * THIRD-PARTY-NOTICES.md sections for the crates a Rust wasm statically links.
 *
 *   node scripts/rust-crate-notices.mjs <metadata.json> <cargo-tree.txt>
 *
 * cargo-tree.txt is `cargo tree --target <t> -e normal,no-proc-macro --prefix none [-p pkg]`
 * of the build's source tree: the crates cargo compiles into that package for
 * that target, with its features. Proc-macro crates and their dependencies run
 * on the build host and are not linked, so they are left out (with them,
 * cargo tree lists host crates such as linux-raw-sys) (a workspace's `cargo metadata` resolve
 * unifies the features of every member, so it lists crates the wasm does not
 * link). metadata.json (`cargo metadata --format-version 1`, same tree, same
 * vendored sources) gives each crate's licence expression and source
 * directory. Local path crates (the package itself, homescoop's crates/) are
 * skipped. Each crate's licence files come from its unpacked source next to
 * its Cargo.toml; for a git dependency, also the directories above it up to the
 * checkout root (facebook/react's crates have only the repository's LICENSE).
 * A registry crate that ships none gets the upstream file pinned in
 * scripts/crate-licences.json ("name version": url + sha256, at the commit in
 * the crate's .cargo_vcs_info.json), fetched and checked here. Failing that,
 * a licence without a copyright line (MPL-2.0: servo's selectors) gets its
 * text from scripts/licence-texts/<SPDX>.txt; anything else is an error. Every section names the crate's
 * source (MPL-2.0 3.2).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeCrates } from './rust-crate-notices-lib.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const texts = join(scripts, 'licence-texts');
const pinned = JSON.parse(readFileSync(join(scripts, 'crate-licences.json'), 'utf8'));
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
  let dir = dirname(p.manifest_path);
  let files = readdirSync(dir).filter((f) => LICENCE.test(f)).sort();
  if (!files.length && p.source.startsWith('git+')) {
    const top = p.manifest_path.match(/^(.*\/git\/checkouts\/[^/]+\/[^/]+)\//)?.[1];
    for (let d = dirname(dir); top && d.length >= top.length && !files.length; d = dirname(d)) {
      const found = readdirSync(d).filter((f) => LICENCE.test(f)).sort();
      if (found.length) {
        dir = d;
        files = found;
      }
    }
  }
  out.push(`\n## ${p.name} ${p.version} (${p.license})\n`);
  if (p.source.startsWith('registry+')) out.push(`\nSource: https://crates.io/crates/${p.name}/${p.version}\n`);
  else out.push(`\nSource: ${p.source.replace(/^git\+/, '')}\n`);
  const pin = pinned[`${p.name} ${p.version}`];
  if (!files.length && pin) {
    const r = spawnSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', pin.url], { encoding: 'buffer', maxBuffer: 1 << 24 });
    if (r.status !== 0) throw new Error(`${p.name} ${p.version}: fetching ${pin.url} failed`);
    const got = createHash('sha256').update(r.stdout).digest('hex');
    if (got !== pin.sha256) throw new Error(`${p.name} ${p.version}: ${pin.url} sha256 ${got} != ${pin.sha256}`);
    out.push(pin.note ? `\n${pin.note} (${pin.url}).\n` : `\nThe crate ships no licence file; this is the upstream repository's, at the commit the crate was published from (${pin.url}).\n`);
    out.push(`\n\`\`\`text\n${r.stdout.toString('utf8').trim()}\n\`\`\`\n`);
    continue;
  }
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
