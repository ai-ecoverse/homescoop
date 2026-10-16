#!/usr/bin/env node
/**
 * THIRD-PARTY-NOTICES.md covers exactly the crates the wasm links: the
 * "## name version" headings equal `cargo tree`'s registry/git crates, and
 * every one of them is a package of the build's Cargo.lock.
 *
 *   node scripts/check-rust-notices.mjs <notices.md> <cargo-tree.txt> <Cargo.lock>
 */
import { readFileSync } from 'node:fs';
import { treeCrates } from './rust-crate-notices-lib.mjs';

const [notices, tree, lock] = process.argv.slice(2).map((f) => readFileSync(f, 'utf8'));
const inNotices = new Set([...notices.matchAll(/^## (\S+) (\S+) \(/gm)].map((m) => `${m[1]} ${m[2]}`));
const inTree = treeCrates(tree);
const inLock = new Set([...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`));
const missing = [...inTree].filter((c) => !inNotices.has(c)).sort();
const extra = [...inNotices].filter((c) => !inTree.has(c)).sort();
const unlocked = [...inNotices].filter((c) => !inLock.has(c)).sort();
for (const [what, list] of [['linked but not in the notices', missing], ['in the notices but not linked', extra], ['not in Cargo.lock', unlocked]]) {
  if (list.length) console.error(`check-rust-notices: ${what}: ${list.join(', ')}`);
}
if (missing.length || extra.length || unlocked.length) process.exit(1);
console.log(`check-rust-notices: ${inNotices.size} crates, the same as cargo tree, all in Cargo.lock`);
