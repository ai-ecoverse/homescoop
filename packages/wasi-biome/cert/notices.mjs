import { readFileSync } from 'node:fs';

export function recipeRust(text = readFileSync(new URL('../recipe.yaml', import.meta.url), 'utf8')) {
  const m = /^toolchain:\n(?:[ \t]+.*\n)*?[ \t]+rust: "(\d+\.\d+\.\d+)"$/m.exec(text);
  if (!m) throw new Error('wasi-biome: recipe.yaml names no toolchain.rust X.Y.Z');
  return m[1];
}

export function wasiSdkOf(rust, text = readFileSync(new URL('../../../scripts/build-common.sh', import.meta.url), 'utf8')) {
  const esc = rust.replaceAll('.', '\\.');
  const row = new RegExp(`^[ \\t]+${esc}\\)\\n([\\s\\S]*?)^[ \\t]+;;$`, 'm').exec(text);
  const sdk = row && /^[ \t]+wasisdk=(wasi-sdk-\d+)$/m.exec(row[1]);
  if (!sdk) throw new Error(`wasi-biome: scripts/build-common.sh's homescoop_notice_rust has no wasi-sdk for Rust ${rust}`);
  return sdk[1];
}

export function checkNotices(assert, text, rust = recipeRust(), sdk = wasiSdkOf(rust)) {
  assert.ok(text, 'THIRD-PARTY-NOTICES.md is installed with the package');
  const std = text.match(/^## Rust .* standard library .*$/gm) || [];
  assert.deepEqual(std, [`## Rust ${rust} standard library (MIT OR Apache-2.0)`], `one Rust standard library section, for recipe.yaml's toolchain.rust ${rust}`);
  const head = `## Rust ${rust} standard library (MIT OR Apache-2.0)\n`;
  const start = text.indexOf(head) + head.length;
  const next = text.slice(start).search(/^## /m);
  const section = text.slice(start, next < 0 ? undefined : start + next);
  assert.match(section, /The Rust Project is dual-licensed under Apache 2\.0 and MIT/, `the Rust ${rust} section carries its COPYRIGHT`);
  assert.match(section, /Permission is hereby granted, free of charge/, `the Rust ${rust} section carries its LICENSE-MIT`);
  assert.match(section, /Apache License\n\s+Version 2\.0, January 2004/, `the Rust ${rust} section carries its LICENSE-APACHE`);
  const libc = text.match(/^## wasi-libc .*$/gm) || [];
  assert.deepEqual(libc, [`## wasi-libc (${sdk}; Rust's self-contained wasm32-wasip1-threads libc)`], `one wasi-libc section, ${sdk}, what Rust ${rust} builds wasm32-wasip1-threads from`);
  assert.match(text, /^## boa_ast \S+ \(Unlicense OR MIT\)\n[^#]*Copyright \(c\) 2019 Jason Williams/m, 'boa_ast, which ships no licence file, carries the repository\'s LICENSE-MIT');
  assert.match(text, /^## grit-pattern-matcher \S+ \(MIT\)\n[^#]*Copyright \(c\) 2025-present Biome Developers and Contributors/m, 'grit-pattern-matcher, which ships no licence file, carries the repository\'s LICENSE at its publish commit');
  assert.match(text, /^## float16 \S+ \(MIT OR Apache-2\.0\)\n[^#]*Apache License/m, 'float16 carries the texts of its LICENSES directory');
}

export default async function ({ read, assert, npmName }) {
  checkNotices(assert, await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`));
}
