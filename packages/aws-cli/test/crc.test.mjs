// botocore/crc.py (awscrt-optional.patch), run by the build machine's
// python3 from the built package, against Node's CRCs (cert/lib/crc.mjs) on
// random data: plain, chained and combined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crcInt } from '../cert/lib/crc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const botocore = join(here, '..', 'package', 'lib', 'aws-cli', 'awscli', 'botocore');

test('botocore.crc matches Node on random data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aws-cli-crc-'));
  try {
    const cases = [0, 1, 7, 8, 1023, 65537].map((n) => [randomBytes(n), randomBytes(n * 3 + 5)]);
    cases.forEach(([a, b], i) => {
      writeFileSync(join(dir, `${i}.a`), a);
      writeFileSync(join(dir, `${i}.b`), b);
    });
    const out = execFileSync('python3', ['-S', '-B', '-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import crc
res = []
for i in range(int(sys.argv[3])):
    a = open(f"{sys.argv[2]}/{i}.a", "rb").read()
    b = open(f"{sys.argv[2]}/{i}.b", "rb").read()
    row = {}
    for alg in ("crc32", "crc32c", "crc64nvme"):
        f, comb = getattr(crc, alg), getattr(crc, "combine_" + alg)
        row[alg] = [str(f(a)), str(f(b, f(a))), str(comb(f(a), f(b), len(b)))]
    res.append(row)
print(json.dumps(res))
`, botocore, dir, String(cases.length)], { encoding: 'utf8' });
    JSON.parse(out).forEach((row, i) => {
      const [a, b] = cases[i];
      const ab = Buffer.concat([a, b]);
      for (const alg of ['crc32', 'crc32c', 'crc64nvme']) {
        const [ga, gab, gcomb] = row[alg].map(BigInt);
        assert.equal(ga, crcInt(a, alg), `${alg} of ${a.length} bytes`);
        assert.equal(gab, crcInt(ab, alg), `${alg} chained, ${a.length}+${b.length}`);
        assert.equal(gcomb, crcInt(ab, alg), `combine_${alg}, ${a.length}+${b.length}`);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
