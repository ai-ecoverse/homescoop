import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ assert, dir, stdout, version }) {
  assert.match(stdout, new RegExp(`^freetype ${version.replaceAll('.', '\\.')}$`, 'm'), 'FT_Library_Version is the recipe version');
  const pgm = readFileSync(join(dir, 'probe.pgm'));
  const head = 'P5\n32 32\n255\n';
  assert.equal(pgm.toString('latin1', 0, head.length), head);
  const px = pgm.subarray(head.length);
  assert.equal(px.length, 32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const yy = 31 - y;
      const inOuter = x >= 2 && x < 30 && yy >= 2 && yy < 30;
      const inHole = x >= 10 && x < 22 && yy >= 10 && yy < 22;
      assert.equal(px[y * 32 + x], inOuter && !inHole ? 255 : 0, `pixel ${x},${y}`);
    }
  }
}
