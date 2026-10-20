/**
 * homescoop#1287's stress row for rustc (1.98.1-8): rustc.wasm's threads
 * (rustc's codegen units, LLVM's) allocate through wasi-libc's malloc,
 * wrapped at the link by scripts/wasm-refresh-malloc.c so a block above a
 * thread's view of the shared memory refreshes the view first (V8's stale
 * per-thread memory length, slicc-kernel#1172).
 * - 3 rounds of `rustc -O` (16 codegen units in parallel) of a generated
 *   400-function program, new each round, under SLICC_WASM_BACKTRACE=1:
 *   rc 0, the program runs, 0 wasm traps.
 * - The initial heap (recipe.yaml wasm.initial-memory, 192 MiB) holds a
 *   small compile: hello world's highest malloc block (HOMESCOOP_WASM_PEAK,
 *   measured in the allocating thread; rustc.wasm's VmSize is its idle main
 *   thread's view) stays below it. Larger compiles grow past it (the -O
 *   rounds log theirs), which the refresh covers.
 * Each rustc runs detached and is polled.
 */
const prog = (k) => {
  let s = 'use std::collections::HashMap;\n';
  for (let i = 0; i < 400; i++) s += `pub fn f${i}(m: &mut HashMap<String, Vec<u64>>, n: u64) -> u64 { let v: Vec<u64> = (0..n).map(|x| x * ${i + k} + 1).collect(); let s = v.iter().sum(); m.insert(format!("k{}", ${i}), v); s }\n`;
  return s + 'fn main() { let mut m = HashMap::new(); let mut t = 0u64; ' + Array.from({ length: 400 }, (_, i) => `t += f${i}(&mut m, 10);`).join(' ') + ' println!("{t} {}", m.len()); }\n';
};

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const W = '/home/rh';
  const sh = (s) => run(['bash', '-c', s], { cwd: W });
  const detached = async (tag, cmd) => {
    await sh(`rm -f ${tag}.rc ${tag}.peak; bash -c 'SLICC_WASM_BACKTRACE=1 HOMESCOOP_WASM_PEAK=${W}/${tag}.peak ${cmd} >${tag}.out 2>${tag}.err; echo $? > ${tag}.rc' </dev/null >/dev/null 2>&1 &`);
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if ((await sh(`[ -s ${tag}.rc ] && echo y`)).stdout.trim() === 'y') break;
      assert.ok(Date.now() - t0 < 900000, `${tag}: rustc finishes within 15 min`);
    }
    const r = await sh(`read -r rc < ${tag}.rc; t=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < ${tag}.err; pk=; [ -s ${tag}.peak ] && read -r pk < ${tag}.peak; echo "rc=$rc traps=$t peak=$pk"; [ $rc = 0 ] || tail -5 ${tag}.err`);
    const m = /rc=(\d+) traps=(\d+) peak=(\d*)/.exec(r.stdout) ?? [];
    return { rc: Number(m[1]), traps: Number(m[2] ?? 1), peak: Number(m[3] || 0), text: r.stdout, s: Math.round((Date.now() - t0) / 1000) };
  };

  await write('home/rh/hi.rs', 'fn main() { println!("hi"); }\n');
  const hi = await detached('hi', 'rustc hi.rs -o hi.wasm');
  assert.equal(hi.rc, 0, `hello: ${hi.text}`);
  const initial = Number(process.env.RUSTC_INITIAL_MIB || 192) * 1048576;
  assert.ok(hi.peak > 0 && hi.peak <= initial, `hello world's heap stays within the initial heap (${hi.peak} bytes of ${initial})`);
  let traps = hi.traps;
  for (let round = 1; round <= 3; round++) {
    await write(`home/rh/p${round}.rs`, prog(round));
    const r = await detached(`p${round}`, `rustc -O p${round}.rs -o p${round}.wasm`);
    traps += r.traps;
    assert.equal(r.rc, 0, `round ${round}: rustc -O: ${r.text}`);
    const out = await sh(`./p${round}.wasm`);
    assert.match(out.stdout, /^\d+ 400\n$/, `round ${round}: the program runs: ${out.stdout}${out.stderr}`);
    console.log(`heap: round ${round}: rustc -O in ${r.s} s, heap ${Math.round(r.peak / 1048576)} MiB`);
  }
  console.log(`heap: hello world's heap ${Math.round(hi.peak / 1048576)} MiB; 3 × rustc -O: ${traps} traps`);
  assert.equal(traps, 0, 'no wasm trap in 4 rustc runs');
}
