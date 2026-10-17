export default async function (ctx) {
  const { run, write, readBytes, assert } = ctx;
  const W = '/home/lc';
  await write('home/lc/m.c', '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(void) { char *s = malloc(32); strcpy(s, "simd128 libc"); printf("%s %zu\\n", s, strlen(s)); free(s); return 0; }\n');
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  let r = await run(['zig', 'cc', '-target', 'wasm32-wasi', '-mcpu=generic+simd128', '-O2', 'm.c', '-o', 'simd.wasm'], { cwd: W });
  assert.equal(r.status, 0, `zig cc for a non-baseline CPU builds wasi-libc from these sources: ${out(r)}`);
  assert.doesNotMatch(r.stderr, /ipk install @ai-ecoverse\/wasi-zig-libc-src/, out(r));
  r = await run([`${W}/simd.wasm`], { cwd: W });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'simd128 libc 12\n');
  const bytes = await readBytes('home/lc/simd.wasm');
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  assert.deepEqual(imports.filter((i) => i.module !== 'wasi_snapshot_preview1'), [], 'preview1 imports only');
  r = await run(['zig', 'cc', '-target', 'wasm32-wasi', '-O2', 'm.c', '-o', 'base.wasm'], { cwd: W });
  assert.equal(r.status, 0, `the baseline still links the prebuilt libc: ${out(r)}`);
  console.log(`simd.wasm ${bytes.length} bytes`);
}
