export default async function ({ read, assert, npmName }) {
  const text = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.ok(text, 'THIRD-PARTY-NOTICES.md is installed with the package');
  assert.match(text, /^## Rust 1\.98\.1 standard library \(MIT OR Apache-2\.0\)$/m);
  const libc = text.match(/^## wasi-libc .*$/gm) || [];
  assert.deepEqual(libc, ["## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1-threads libc)"]);
  assert.match(text, /^## boa_ast \S+ \(Unlicense OR MIT\)\n[^#]*Copyright \(c\) 2019 Jason Williams/m, 'boa_ast, which ships no licence file, carries the repository\'s LICENSE-MIT');
  assert.match(text, /^## float16 \S+ \(MIT OR Apache-2\.0\)\n[^#]*Apache License/m, 'float16 carries the texts of its LICENSES directory');
}
