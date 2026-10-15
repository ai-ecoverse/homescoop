import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'fixtures');
export const FIXTURES = JSON.parse(readFileSync(join(dir, 'fixtures.json'), 'utf8'));
const cache = process.env.HOMESCOOP_LIBHEIF_FIXTURES || join(tmpdir(), 'homescoop-libheif-fixtures');

const sha = (b) => createHash('sha256').update(b).digest('hex');

export async function fixture(name) {
  const f = FIXTURES[name];
  if (!f) throw new Error(`unknown fixture ${name}`);
  let buf;
  if (f.file) {
    buf = readFileSync(join(dir, f.file));
  } else {
    const p = join(cache, `${f.sha256}-${name}`);
    if (existsSync(p)) {
      buf = readFileSync(p);
    } else {
      let last;
      for (let i = 0; i < 4 && !buf; i++) {
        try {
          const r = await fetch(f.url);
          if (!r.ok) throw new Error(`${f.url}: HTTP ${r.status}`);
          buf = Buffer.from(await r.arrayBuffer());
        } catch (e) {
          last = e;
          await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
        }
      }
      if (!buf) throw last;
      mkdirSync(cache, { recursive: true });
      writeFileSync(p, buf);
    }
  }
  if (sha(buf) !== f.sha256) throw new Error(`fixture ${name}: sha256 ${sha(buf)} != ${f.sha256}`);
  return buf;
}
