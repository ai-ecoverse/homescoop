// homescoop#883: WOFF2 needs the brotli extension, which homescoop doesn't
// ship, so a WOFF2 save fails with fontTools' "requires the Brotli" error
// (README "Known limitations"). Pinned so a brotli package (or a different
// failure) shows. WOFF (zlib) works.
export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/fonttools_woff2.py', String.raw`
import io, json
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder([".notdef", "A"]); fb.setupCharacterMap({65: "A"})
pen = TTGlyphPen(None); pen.moveTo((0, 0)); pen.lineTo((500, 700)); pen.lineTo((1000, 0)); pen.closePath()
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "A": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (1000, 0)}); fb.setupHorizontalHeader()
fb.setupNameTable({"familyName": "P", "styleName": "R"}); fb.setupOS2(); fb.setupPost()
out = {}
for flavor in ("woff", "woff2"):
    f = fb.font; f.flavor = flavor; b = io.BytesIO()
    try:
        f.save(b); out[flavor] = [b.getvalue()[:4].decode("latin1"), TTFont(io.BytesIO(b.getvalue())).getBestCmap()]
    except Exception as e:
        out[flavor] = [type(e).__name__, "rotli" in str(e)]
print(json.dumps(out))
`);
  const r = await run(['python3', '/tmp/fonttools_woff2.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out.woff, ['wOFF', { 65: 'A' }], JSON.stringify(out));
  assert.equal(out.woff2[1], true, `WOFF2 fails for want of brotli: ${JSON.stringify(out)}`);
  console.log(`woff2 (#883): WOFF saves and reopens; WOFF2 fails with ${out.woff2[0]} naming brotli (documented)`);
}
