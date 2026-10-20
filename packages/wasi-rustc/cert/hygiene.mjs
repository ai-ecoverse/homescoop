/**
 * What a compile leaves and says (1.98.1-7, patches/0016), as alice under
 * users enforce:
 * - homescoop#953: after `rustc hi.rs -o hi.wasm` the directory holds only
 *   hi.rs and hi.wasm. 0004's in-process LLD call exited the process right
 *   after linking, so link_binary never removed the *.rcgu.o objects or its
 *   rustcXXXXXX temp dir; 0016 returns to it.
 * - homescoop#1237: `-C lto=fat` and `-C lto=thin` either build a program
 *   that runs, or fail with a diagnostic on stderr, never a silent exit 1.
 *   An LTO error is emitted to the codegen's shared emitter, and 0015's WASI
 *   fatal exit didn't drain it; 0016 does. The cause is the std bitcode's
 *   LLVM 22 against rustc.wasm's LLVM 21, so 0017 refuses -C lto=fat/thin up
 *   front with that reason (a ThinLTO worker can't report on WASI).
 * - homescoop#1087: no slicc.dependencies (no wasm-clang): rustc links with
 *   the LLD inside rustc.wasm.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  await ctx.addUser({ name: 'alice' });
  const sh = (s) => run(['bash', '-c', s], { cwd: '/home/alice/t', user: 'alice' });
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-2500)}`;
  await write('/home/alice/t/hi.rs', 'fn main() { println!("hi from rustc"); }\n');

  const plain = await sh('rustc hi.rs -o hi.wasm && ./hi.wasm && ls -A');
  assert.equal(plain.status, 0, `rustc hi.rs: ${out(plain)}`);
  assert.match(plain.stdout, /^hi from rustc$/m);
  const left = plain.stdout.split('\n').filter((l) => l && l !== 'hi from rustc').sort();
  assert.deepEqual(left, ['hi.rs', 'hi.wasm'], `#953 only the source and the program are left: ${left.join(' ')}`);

  for (const lto of ['fat', 'thin']) {
    const r = await sh(`rm -f lto.wasm; rustc -O -C lto=${lto} hi.rs -o lto.wasm && ./lto.wasm`);
    if (r.status === 0) {
      assert.match(r.stdout, /^hi from rustc$/m, `#1237 -C lto=${lto} builds a program that runs: ${out(r)}`);
    } else {
      assert.match(r.stderr, /error/, `#1237 -C lto=${lto} fails with a diagnostic, not silently: ${out(r)}`);
    }
    console.log(`hygiene: -C lto=${lto}: ${r.status === 0 ? 'builds and runs' : `fails: ${r.stderr.trim().split('\n').find((l) => /error/.test(l))}`}`);
    const after = await sh('ls -A');
    const rest = after.stdout.split('\n').filter((l) => l && !['hi.rs', 'hi.wasm', 'lto.wasm'].includes(l));
    assert.deepEqual(rest, [], `#953 -C lto=${lto} leaves no objects or temp dirs: ${rest.join(' ')}`);
  }

  const bad = await sh("printf 'fn main() { let x: u32 = \"no\"; }\\n' > bad.rs; rustc bad.rs -o bad.wasm");
  assert.notEqual(bad.status, 0, 'a type error fails');
  assert.match(bad.stderr, /error\[E0308\]/, `a type error is reported: ${out(bad)}`);
  const leftBad = await sh('ls -A');
  assert.doesNotMatch(leftBad.stdout, /rcgu|^rustc/m, `#953 a failed compile leaves nothing either: ${leftBad.stdout}`);

  const pkg = JSON.parse((await run(['cat', '/node_modules/@ai-ecoverse/wasi-rustc/package.json'], { cwd: '/' })).stdout);
  assert.equal(pkg.slicc.dependencies, undefined, `#1087 no slicc.dependencies: ${JSON.stringify(pkg.slicc.dependencies)}`);
  console.log('hygiene: a compile leaves only its output; LTO builds or says why; no wasm-clang dependency');
}
