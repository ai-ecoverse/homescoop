import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import io, json
from PIL import Image, ImageDraw, ImageFilter, ImageFont, features
im = Image.new("RGB", (64, 48), (10, 20, 30))
d = ImageDraw.Draw(im)
d.rectangle([8, 8, 31, 23], fill=(200, 100, 50))
d.text((34, 4), "Hi", fill=(255, 255, 255), font=ImageFont.load_default(size=16))
out = {"features": {k: features.check(k) for k in ("jpg", "zlib", "freetype2")}}
out["font"] = type(ImageFont.load_default(size=16)).__name__
out["px"] = [im.getpixel((10, 10)), im.getpixel((0, 0))]
out["text"] = sum(1 for px in im.crop((34, 0, 64, 24)).getdata() if px != (10, 20, 30))
small = im.resize((32, 24), Image.Resampling.LANCZOS)
out["small"] = [small.size, small.getpixel((8, 8))]
buf = io.BytesIO(); im.save(buf, "PNG"); png = buf.getvalue()
back = Image.open(io.BytesIO(png)); back.load()
out["png"] = [png[:8].hex(), back.size, back.mode, back.getpixel((10, 10))]
buf = io.BytesIO(); im.save(buf, "JPEG", quality=90); jpg = buf.getvalue()
j = Image.open(io.BytesIO(jpg)); j.load()
out["jpeg"] = [jpg[:3].hex(), j.format, j.size, [abs(a - b) <= 8 for a, b in zip(j.getpixel((16, 16)), (200, 100, 50))]]
out["blur"] = im.filter(ImageFilter.GaussianBlur(2)).getpixel((8, 8)) != im.getpixel((8, 8))
out["gray"] = im.convert("L").getpixel((10, 10))
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/pillow_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/pillow_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.features, { jpg: true, zlib: true, freetype2: true }, o);
  assert.equal(out.font, 'FreeTypeFont', o);
  assert.deepEqual(out.px, [[200, 100, 50], [10, 20, 30]], o);
  assert.ok(out.text > 20, `FreeType drew "Hi": ${out.text} pixels off the background: ${o}`);
  assert.deepEqual(out.small[0], [32, 24], o);
  assert.deepEqual(out.png, ['89504e470d0a1a0a', [64, 48], 'RGB', [200, 100, 50]], o);
  assert.deepEqual(out.jpeg, ['ffd8ff', 'JPEG', [64, 48], [true, true, true]], o);
  assert.equal(out.blur, true, o);
  assert.equal(out.gray, Math.floor((200 * 299 + 100 * 587 + 50 * 114) / 1000 + 0.5), o);
  console.log(`Pillow on wasix-python ${python}: draw + FreeType text, LANCZOS resize, PNG and JPEG round trips, GaussianBlur, convert L`);
}
