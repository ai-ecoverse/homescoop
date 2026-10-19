const SCRIPT = String.raw`
import io, json, os
from PIL import Image, ImageFont, ImageMath, ImageMorph
home = os.path.expanduser("~")
im = Image.new("RGB", (64, 48), (10, 120, 30))
for x in range(20, 30):
    for y in range(10, 20):
        im.putpixel((x, y), (255, 255, 255))
out = {"uid": os.getuid()}
g = im.convert("L")
out["math"] = list(ImageMath.lambda_eval(lambda a: a["a"] * 2 + 1, a=g).getextrema())
bw = Image.new("L", (16, 16), 0)
bw.putpixel((8, 8), 255)
out["morph"] = ImageMorph.MorphOp(op_name="dilation4").apply(bw)[0] > 0
rt = {}
for fmt in ("PNG", "JPEG", "GIF", "BMP", "TIFF", "PPM", "TGA", "QOI", "ICO"):
    b = io.BytesIO()
    src = im if fmt != "GIF" else im.convert("P")
    src.save(b, fmt)
    back = Image.open(io.BytesIO(b.getvalue()))
    back.load()
    rt[fmt] = [back.format, back.size[0] > 0]
out["roundtrip"] = rt
ttf = os.path.join(home, "f.ttf")
with open(ttf, "wb") as f:
    f.write(ImageFont.load_default(size=20).font_bytes)
font = ImageFont.truetype(ttf, 24)
out["truetype"] = font.getbbox("Hi")[2] > 0
jp = os.path.join(home, "p.jpg")
Image.new("RGB", (800, 600), (200, 30, 30)).save(jp, quality=85)
j = Image.open(jp)
j.draft("RGB", (200, 150))
j.thumbnail((100, 100))
out["jpeg_home"] = [j.size[0] <= 100, j.mode]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pil_ops.py', SCRIPT);
  const opts = { cwd: '/tmp' };
  if (typeof ctx.addUser === 'function') {
    const u = await ctx.addUser({ name: 'pil' });
    opts.user = u?.name ?? 'pil';
    opts.cwd = '/home/pil';
  }
  const r = await run(['python3', '/tmp/pil_ops.py'], opts);
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.math, [155, 511], o);
  assert.equal(out.morph, true, o);
  for (const [fmt, v] of Object.entries(out.roundtrip)) assert.deepEqual(v, [fmt, true], `${fmt} round trip: ${o}`);
  assert.equal(Object.keys(out.roundtrip).length, 9, o);
  assert.equal(out.truetype, true, o);
  assert.deepEqual(out.jpeg_home, [true, 'RGB'], o);
  console.log(`Pillow as uid ${out.uid}: ImageMath (a*2+1 extrema ${out.math.join('..')}), ImageMorph dilation4, round trips in ${Object.keys(out.roundtrip).join('/')}, ImageFont.truetype from ~/f.ttf, a JPEG in ~ reopened with draft + thumbnail`);
}
