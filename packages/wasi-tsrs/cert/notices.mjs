export default async function ({ read, assert, npmName }) {
  const text = await read(`/node_modules/${npmName}/THIRD-PARTY-NOTICES.md`);
  assert.ok(text, 'THIRD-PARTY-NOTICES.md is installed with the package');
  assert.match(text, /^## Rust 1\.99\.1 standard library \(MIT OR Apache-2\.0\)$/m);
  const libc = text.match(/^## wasi-libc .*$/gm) || [];
  assert.deepEqual(libc, ["## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1 libc)"]);
}
