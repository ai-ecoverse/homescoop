/**
 * THIRD-PARTY-NOTICES.md: Rust 1.99.1's standard library and one wasi-libc
 * (wasi-sdk-33, what Rust 1.99.1 builds wasm32-wasip1 from), Oniguruma's
 * BSD-2-Clause licence (onig_sys's bundled C), the patched crates, and bat's
 * acknowledgements of its bundled syntaxes and themes, exactly what
 * `bat --acknowledgements` prints. NOTICE and LICENSE are bat's.
 */
export default async function ({ read, run, assert, npmName }) {
  const dir = `/node_modules/${npmName}`;
  const text = await read(`${dir}/THIRD-PARTY-NOTICES.md`);
  assert.ok(text, 'THIRD-PARTY-NOTICES.md is installed with the package');
  assert.match(text, /^## Rust 1\.99\.1 standard library \(MIT OR Apache-2\.0\)$/m);
  const libc = text.match(/^## wasi-libc .*$/gm) || [];
  assert.deepEqual(libc, ["## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1 libc)"]);
  const onig = text.match(/^## Oniguruma 6\.9\.\d+ \(BSD-2-Clause; bundled in onig_sys-69\.9\.1, oniguruma\/COPYING\)\n([\s\S]*?)\n## /m);
  assert.ok(onig, 'an Oniguruma section');
  assert.match(onig[1], /Copyright \(c\) 2002-2021 {2}K\.Kosako/);
  assert.match(onig[1], /Redistributions in binary form must reproduce the above copyright/);
  for (const c of ['clircle 0.6.1', 'console 0.16.0', 'etcetera 0.11.0', 'onig 6.5.1', 'onig_sys 69.9.1', 'syntect 5.3.0']) {
    assert.match(text, new RegExp(`^## ${c.replaceAll('.', '\\.')} \\(`, 'm'), `a section for ${c}`);
  }
  for (const c of ['git2', 'libgit2-sys', 'minus', 'crossterm']) {
    assert.doesNotMatch(text, new RegExp(`^## ${c} `, 'm'), `${c} is not linked`);
  }
  const ack = await run(['bat', '--acknowledgements'], { cwd: '/tmp' });
  assert.equal(ack.status, 0, ack.stderr);
  assert.match(ack.stdout, /^## syntaxes\/02_Extra\/Zig\/LICENSE$/m);
  assert.ok(ack.stdout.length > 100000, `bat --acknowledgements is ${ack.stdout.length} bytes`);
  const heading = "## bat's syntaxes and themes (assets/acknowledgements.bin; bat --acknowledgements)\n\n```text\n";
  assert.ok(text.includes(`${heading}${ack.stdout.trimEnd()}\n\`\`\`\n`), 'THIRD-PARTY-NOTICES.md has bat --acknowledgements verbatim');
  assert.match(await read(`${dir}/NOTICE`), /^Copyright \(c\) 2018-2021 bat-developers/);
  const licence = await read(`${dir}/LICENSE`);
  assert.match(licence, /^bat is dual-licensed under MIT OR Apache-2\.0\./);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  assert.match(licence, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
}
