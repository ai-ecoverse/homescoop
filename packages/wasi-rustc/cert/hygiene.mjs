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
 * - homescoop#1439/#1464 (1.98.1-9, 0018): a failed link leaves nothing
 *   behind; -C lto on an rlib builds (0017 only refuses crate types that
 *   link upstream bitcode).
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

  // homescoop#1439 (1.98.1-9, 0018): a compile that fails at the link
  // (an undefined extern) leaves no objects or temp dir either: the link
  // error is a plain error now, so link_binary's cleanup runs before the
  // driver aborts.
  await write('/home/alice/t/link.rs', 'extern "C" { fn nope(); }\nfn main() { unsafe { nope() } }\n');
  const link = await sh('rm -f *.wasm lto.wasm; rustc link.rs -o link.wasm');
  assert.notEqual(link.status, 0, `a link failure fails: ${out(link)}`);
  assert.match(link.stderr, /undefined symbol: nope/, `LLD's error is shown: ${out(link)}`);
  assert.match(link.stderr, /linking with rust-lld failed/, `and rustc's: ${out(link)}`);
  const leftLink = await sh('ls -A');
  assert.doesNotMatch(leftLink.stdout, /rcgu|^rustc/m, `#1439 a failed link leaves no objects or temp dir: ${leftLink.stdout}`);

  // homescoop#1464 (0018): an rlib with -C lto reads no upstream bitcode,
  // so 0017's refusal doesn't apply: it builds, and leaves nothing else.
  await write('/home/alice/t/lib.rs', 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n');
  const rlib = await sh('rustc -C lto=fat --crate-type rlib lib.rs -o lto.rlib && ls -A');
  assert.equal(rlib.status, 0, `#1464 -C lto=fat --crate-type rlib builds: ${out(rlib)}`);
  assert.match(rlib.stdout, /^lto\.rlib$/m, `#1464 the rlib is written: ${rlib.stdout}`);
  assert.doesNotMatch(rlib.stdout, /rcgu|^rustc|^rmeta/m, `#1464 and no temp files are left: ${rlib.stdout}`);

  const pkg = JSON.parse((await run(['cat', '/node_modules/@ai-ecoverse/wasi-rustc/package.json'], { cwd: '/' })).stdout);
  assert.equal(pkg.slicc.dependencies, undefined, `#1087 no slicc.dependencies: ${JSON.stringify(pkg.slicc.dependencies)}`);
  console.log('hygiene: a compile leaves only its output; LTO builds or says why; no wasm-clang dependency');
}
