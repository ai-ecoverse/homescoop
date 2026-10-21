/**
 * cargo test, and cargo's own memory (0.99.0-4), as root:
 * - homescoop#1043: `cargo new hello && cargo test --offline` builds the
 *   test harness and passes. With wasi-rustc 1.98.1-4 (the cert's rustc up
 *   to 0.99.0-3) the link failed on pthread_join/pthread_detach; wasi-rustc
 *   1.98.1-5+ ships wasi-sdk 34's wasm32-wasip1 libc, which has them.
 * - homescoop#1287: 4 rounds of a clean `cargo build` of a 3-crate
 *   workspace under SLICC_WASM_BACKTRACE=1, with 0 wasm traps in cargo, and
 *   cargo's wasm memory (VmSize, /proc/<pid>/status, polled once a second
 *   by short runs) within the recipe's initial heap.
 */
const WS = {
  'Cargo.toml': '[workspace]\nmembers = ["a", "b", "c"]\nresolver = "2"\n',
  'a/Cargo.toml': '[package]\nname = "a"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nb = { path = "../b" }\nc = { path = "../c" }\n',
  'a/src/main.rs': 'fn main() { println!("{} {}", b::f(3), c::g(4)); }\n',
  'b/Cargo.toml': '[package]\nname = "b"\nversion = "0.1.0"\nedition = "2021"\n',
  'b/src/lib.rs': 'pub fn f(n: u64) -> u64 { (1..=n).product() }\n#[cfg(test)] mod t { #[test] fn f3() { assert_eq!(super::f(3), 6); } }\n',
  'c/Cargo.toml': '[package]\nname = "c"\nversion = "0.1.0"\nedition = "2021"\n',
  'c/src/lib.rs': 'pub fn g(n: u64) -> u64 { (1..=n).sum() }\n',
};

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-2500)}`;
  const sh = (s, cwd = '/home') => run(['bash', '-c', s], { cwd, env: { SLICC_WASM_BACKTRACE: '1' } });

  let r = await sh('cargo new --vcs none hello');
  assert.equal(r.status, 0, `cargo new: ${out(r)}`);
  r = await sh('cargo test --offline', '/home/hello');
  assert.equal(r.status, 0, `#1043 cargo test in a new project: ${out(r)}`);
  assert.match(r.stdout, /test result: ok\. 0 passed/, `#1043 the (empty) test harness runs: ${out(r)}`);
  assert.doesNotMatch(r.stderr, /pthread_(join|detach)/, `#1043 ${out(r)}`);

  // homescoop#1463 (0.99.0-5): wasi-rustc ships no rustdoc. cargo test on a
  // library with a doc test runs its unit tests, skips the doc tests with
  // one line on stderr and exits 0; cargo test --doc and cargo doc fail
  // with the reason.
  r = await sh('cargo new --vcs none --lib dl');
  assert.equal(r.status, 0, `cargo new --lib: ${out(r)}`);
  await write('home/dl/src/lib.rs', '/// ```\n/// assert_eq!(dl::two(), 2);\n/// ```\npub fn two() -> u32 { 2 }\n#[cfg(test)] mod t { #[test] fn two() { assert_eq!(super::two(), 2); } }\n');
  r = await sh('cargo test --offline', '/home/dl');
  assert.equal(r.status, 0, `#1463 cargo test on a library with a doc test: ${out(r)}`);
  assert.match(r.stdout, /test t::two \.\.\. ok/, `#1463 its unit test runs: ${out(r)}`);
  assert.match(r.stderr, /doc tests skipped: rustdoc isn't available in slicc/, `#1463 the doc tests are skipped with the reason: ${out(r)}`);
  r = await sh('cargo test --offline --doc', '/home/dl');
  assert.notEqual(r.status, 0, `#1463 cargo test --doc fails: ${out(r)}`);
  assert.match(r.stderr, /cargo test --doc needs rustdoc: rustdoc isn't available in slicc/, `#1463 with the reason: ${out(r)}`);
  r = await sh('cargo doc --offline', '/home/dl');
  assert.notEqual(r.status, 0, `#1463 cargo doc fails: ${out(r)}`);
  assert.match(r.stderr, /cargo doc needs rustdoc: rustdoc isn't available in slicc/, `#1463 with the reason: ${out(r)}`);
  r = await sh('cargo rustdoc --offline', '/home/dl');
  assert.notEqual(r.status, 0, `#1540 cargo rustdoc fails: ${out(r)}`);
  assert.match(r.stderr, /cargo rustdoc needs rustdoc: rustdoc isn't available in slicc/, `#1540 with the reason: ${out(r)}`);
  assert.doesNotMatch(r.stderr, /os error 44/, `#1540 not the raw error: ${out(r)}`);

  for (const [path, text] of Object.entries(WS)) await write(`home/ws/${path}`, text);
  // --lib: doc tests run rustdoc, which the package doesn't ship (README).
  r = await sh('cargo test --offline --lib -p b', '/home/ws');
  assert.equal(r.status, 0, `#1043 cargo test --lib -p b: ${out(r)}`);
  assert.match(r.stdout, /test t::f3 \.\.\. ok/, `#1043 a unit test runs and passes: ${out(r)}`);

  let peak = 0;
  let traps = 0;
  for (let round = 1; round <= 4; round++) {
    const start = await sh(`rm -rf target build.rc; bash -c 'cargo build --offline >build.out 2>build.err & echo $! > build.pid; wait $!; echo $? > build.rc' </dev/null >/dev/null 2>&1 &`, '/home/ws');
    assert.equal(start.status, 0, out(start));
    let rc;
    for (let i = 0; i < 600 && rc === undefined; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      const p = await sh('[ -s build.rc ] && { read -r rc < build.rc; echo "done $rc"; exit 0; }; [ -s build.pid ] || exit 0; read -r pid < build.pid; while read -r k v u; do [ "$k" = VmSize: ] && echo "vm $v"; done < /proc/$pid/status 2>/dev/null; exit 0', '/home/ws');
      const d = /done (\d+)/.exec(p.stdout);
      if (d) rc = Number(d[1]);
      const v = /vm (\d+)/.exec(p.stdout);
      if (v) peak = Math.max(peak, Number(v[1]));
    }
    const e = await sh('t=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < build.err; echo "traps=$t"', '/home/ws');
    traps += Number(/traps=(\d+)/.exec(e.stdout)?.[1] ?? 1);
    assert.equal(rc, 0, `round ${round}: cargo build: rc=${rc} ${(await sh('cat build.err', '/home/ws')).stdout.slice(-1500)}`);
  }
  r = await sh('./target/wasm32-wasip1/debug/a.wasm', '/home/ws');
  assert.equal(r.stdout, '6 10\n', out(r));
  console.log(`test: cargo test passes; 4 × cargo build of a 3-crate workspace: ${traps} traps, cargo peak ${Math.round(peak / 1024)} MiB`);
  assert.equal(traps, 0, 'no wasm trap in cargo');
  const limit = Number(process.env.CARGO_INITIAL_MIB || 64) * 1024;
  assert.ok(peak > 0 && peak <= limit, `cargo's wasm memory stays within the initial heap (peak ${peak} kB, limit ${limit} kB)`);
}
