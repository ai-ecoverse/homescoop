/**
 * Deeply nested markup (0.1.15-6, homescoop#620; upstream behaviour). The
 * engine's per-element checks walk each element's ancestors (effective
 * opacity, non-rendered markup, the text surface; crates/html/src/adapters.rs
 * check_element_colors), so `detect` costs elements × depth. A native
 * release build of upstream 0.1.15 takes 1.4 / 3.0 / 15.4 / 82.9 s for
 * 1000 / 2000 / 4000 / 8000 nested <div>s; the wasm is about 2.5× that.
 * This row bounds the cost at depths real pages reach (1000 and 2000 deep:
 * rc 0, within 30 s and 60 s), and the README says where it climbs.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (const [depth, limit] of [[1000, 30], [2000, 60]]) {
    await write(`home/deep/d${depth}.html`, '<div>'.repeat(depth) + 'x' + '</div>'.repeat(depth));
    const t0 = Date.now();
    const r = await run(['impeccable', 'detect', `d${depth}.html`], { cwd: '/home/deep' });
    const s = (Date.now() - t0) / 1000;
    console.log(`deep: ${depth} nested divs: rc ${r.status} in ${s.toFixed(1)} s`);
    assert.equal(r.status, 0, `${depth} deep: rc=${r.status} ${r.stderr.slice(-500)}`);
    assert.ok(s < limit, `${depth} deep finishes within ${limit} s (${s.toFixed(1)} s)`);
  }
}
