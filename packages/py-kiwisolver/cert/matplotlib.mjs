const SCRIPT = String.raw`
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
def panels(layout):
    fig, axs = plt.subplots(2, 2, layout=layout, figsize=(4, 3), dpi=50)
    for i, ax in enumerate(axs.flat):
        ax.plot([0, 1, 2], [i, i + 1, i * 2])
        ax.set_title("panel %d" % i)
        ax.set_ylabel("a long y label %d" % i)
    fig.colorbar(axs[0, 1].imshow([[0, 1], [2, 3]]), ax=axs[:, 1])
    fig.savefig("/tmp/kiwi_%s.png" % layout)
    engine = fig.get_layout_engine()
    return [type(engine).__name__ if engine else None, [round(ax.get_position().x0, 3) for ax in axs.flat]]
out = {"constrained": panels("constrained"), "none": panels(None)}
out["png"] = open("/tmp/kiwi_constrained.png", "rb").read()[:8].hex()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/kiwi_mpl.py', SCRIPT);
  const r = await run(['python3', '/tmp/kiwi_mpl.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.constrained[0], 'ConstrainedLayoutEngine', o);
  assert.equal(out.png, '89504e470d0a1a0a', o);
  assert.notDeepEqual(out.constrained[1], out.none[1], `constrained layout must move the axes away from the default grid: ${o}`);
  assert.ok(out.constrained[1][0] > out.none[1][0], `the long y labels push the left column right: ${o}`);
  console.log(`matplotlib layout="constrained": 2x2 axes with titles, y labels and a colorbar save a PNG; the left column starts at x0 ${out.constrained[1][0]} (default layout ${out.none[1][0]})`);
}
