import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import io, json
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
def box(x0, y0, x1, y1):
    p = TTGlyphPen(None)
    p.moveTo((x0, y0)); p.lineTo((x0, y1)); p.lineTo((x1, y1)); p.lineTo((x1, y0)); p.closePath()
    return p.glyph()
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder([".notdef", "A", "space"])
fb.setupCharacterMap({0x41: "A", 0x20: "space"})
fb.setupGlyf({".notdef": box(50, 0, 450, 700), "A": box(100, 0, 500, 700), "space": TTGlyphPen(None).glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 50), "A": (600, 100), "space": (250, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Cert", "styleName": "Regular"})
fb.setupOS2(); fb.setupPost()
buf = io.BytesIO(); fb.save(buf)
f = TTFont(io.BytesIO(buf.getvalue()))
gs = f.getGlyphSet(); bp = BoundsPen(gs); gs["A"].draw(bp)
print(json.dumps({"order": f.getGlyphOrder(), "cmap": {hex(k): v for k, v in sorted(f.getBestCmap().items())}, "adv": f["hmtx"]["A"][0], "bounds": list(bp.bounds), "family": f["name"].getDebugName(1), "tables": sorted(f.keys())[:4], "magic": buf.getvalue()[:4].hex()}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/fonttools_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/fonttools_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.order, ['.notdef', 'A', 'space'], o);
  assert.deepEqual(out.cmap, { '0x20': 'space', '0x41': 'A' }, o);
  assert.equal(out.adv, 600, o);
  assert.deepEqual(out.bounds, [100, 0, 500, 700], o);
  assert.equal(out.family, 'Cert', o);
  assert.equal(out.magic, '00010000', o);
  console.log(`fontTools on wasix-python ${python}: FontBuilder TTF saved and reopened, cmap, hmtx, BoundsPen`);
}
