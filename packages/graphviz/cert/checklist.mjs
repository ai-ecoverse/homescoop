/** graphviz checklist: dot's version, JSON and SVG layouts, the engines, errors, a PS usershape. */
export default async function (ctx) {
  const {
    run, write, assert,
  } = ctx;
  const graph = 'digraph g { rankdir=LR; a -> b -> c; a -> c; subgraph cluster_x { label="X"; b } }';

  const ver = await run(['dot', '-V']);
  assert.equal(ver.status, 0, `-V stderr=${ver.stderr}`);
  assert.match(ver.stderr, /^dot - graphviz version \d+\.\d+\.\d+/);

  // The layout as JSON: the three nodes placed, the cluster drawn, three edges.
  const json = await run(['dot', '-Tjson'], { stdin: graph });
  assert.equal(json.status, 0, `json stderr=${json.stderr}`);
  const layout = JSON.parse(json.stdout);
  assert.equal(layout.name, 'g');
  assert.deepEqual(layout.objects.filter((o) => o.pos).map((o) => o.name).sort(), ['a', 'b', 'c']);
  assert.ok(layout.objects.some((o) => o.name === 'cluster_x' && o.bb), 'the cluster has a box');
  assert.equal(layout.edges.length, 3);
  // rankdir=LR: a left of b left of c.
  const x = (n) => Number(layout.objects.find((o) => o.name === n).pos.split(',')[0]);
  assert.ok(x('a') < x('b') && x('b') < x('c'), 'laid out left to right');

  const svg = await run(['dot', '-Tsvg'], { stdin: graph });
  assert.equal(svg.status, 0, `svg stderr=${svg.stderr}`);
  assert.match(svg.stdout, /<svg [^>]*>/);
  assert.equal((svg.stdout.match(/class="node"/g) || []).length, 3);
  assert.equal((svg.stdout.match(/class="edge"/g) || []).length, 3);

  // Every layout engine is linked in (dot_static, no plugins to load).
  for (const engine of ['dot', 'neato', 'fdp', 'circo', 'twopi', 'osage', 'patchwork']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await run(['dot', `-K${engine}`, '-Tplain'], { stdin: 'graph { a -- b -- c -- a }' });
    assert.equal(r.status, 0, `${engine} stderr=${r.stderr}`);
    assert.match(r.stdout, /^graph [\d.]+ [\d.]+ [\d.]+\n(node .*\n){3}/, engine);
  }

  // A file argument, and xdot output.
  await write('/tmp/gv/g.dot', graph);
  const file = await run(['dot', '-Txdot', '/tmp/gv/g.dot']);
  assert.equal(file.status, 0, `file stderr=${file.stderr}`);
  assert.match(file.stdout, /_draw_=/);

  // Errors: a syntax error, an unknown format.
  const bad = await run(['dot', '-Tjson'], { stdin: 'digraph { a -> }' });
  assert.notEqual(bad.status, 0, 'a syntax error must fail');
  assert.match(bad.stderr, /syntax error in line 1/);
  const gts = await run(['dot', '-Ksfdp', '-Tplain'], { stdin: 'graph { a -- b }' });
  // No GTS: sfdp removes overlaps with its triangulation, and does not run without it.
  assert.notEqual(gts.status, 0, 'sfdp needs GTS, which is not built');
  assert.match(gts.stderr, /not built with triangulation library/);
  const fmt = await run(['dot', '-Tpng'], { stdin: graph });
  assert.notEqual(fmt.status, 0, 'png is not built');
  assert.match(fmt.stderr, /Format: "png" not recognized/);

  // loadimage-unistd.patch: without <sys/mman.h>, a PostScript usershape is read with read(2).
  await write('/tmp/gv/box.ps', '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 20 10\nnewpath 0 0 moveto 20 0 lineto stroke\n');
  const ps = await run(['dot', '-Tps'], { stdin: 'digraph { a [shape=epsf, shapefile="/tmp/gv/box.ps"] }' });
  assert.equal(ps.status, 0, `ps stderr=${ps.stderr}`);
  assert.match(ps.stdout, /20 0 lineto stroke/, 'the usershape is in the output');
}
