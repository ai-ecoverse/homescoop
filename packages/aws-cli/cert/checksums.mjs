import { randomBytes } from 'node:crypto';
import { LIB, ok } from './lib/aws.mjs';
import { crcInt } from './lib/crc.mjs';

// awscrt-optional.patch: without awscrt, botocore.crc computes CRC32C and
// CRC64NVME in pure Python and combines CRC32, CRC32C and CRC64NVME (the
// full-object checksum of a multipart download), with awscrt.checksums'
// signatures. Checked here in wasix-python against the published check
// values and against Node's reference implementation (cert/lib/crc.mjs) on
// random data, chained and combined. The checksum classes botocore picks are
// those, the default request checksum is CRC32, and xxhash is unavailable.
export default async function (ctx) {
  const { assert, write } = ctx;
  const a = randomBytes(70001);
  const b = randomBytes(130003);
  await write('/tmp/crc-a.bin', a);
  await write('/tmp/crc-b.bin', b);
  const py = `
import json, sys
sys.path.insert(0, "${LIB}")
import awscli
from botocore import crc, httpchecksum as h
from s3transfer import checksums as s3c
a = open("/tmp/crc-a.bin", "rb").read()
b = open("/tmp/crc-b.bin", "rb").read()
out = {"check": [crc.crc32c(b"123456789"), crc.crc64nvme(b"123456789"), crc.crc32(b"123456789")]}
for alg in ("crc32", "crc32c", "crc64nvme"):
    f = getattr(crc, alg)
    comb = getattr(crc, "combine_" + alg)
    out[alg] = {
        "a": f(a), "ab": f(b, f(a)), "empty": f(b""), "zero": comb(f(a), f(b""), 0),
        "combined": comb(f(a), f(b), len(b)),
        "s3transfer": s3c._CRC_COMBINE_FUNCTIONS[alg].combine_fn is comb,
    }
c = h._CHECKSUM_CLS["crc64nvme"]()
c.update(a); c.update(b)
out["class"] = [c.digest().hex(), sorted(h._CHECKSUM_CLS), h.DEFAULT_CHECKSUM_ALGORITHM, h.HAS_CRT]
# Integers as strings: a CRC64 is past JSON's (and JavaScript's) 2**53.
def text(v):
    if isinstance(v, dict): return {k: text(x) for k, x in v.items()}
    if isinstance(v, list): return [text(x) for x in v]
    return str(v) if type(v) is int else v
print(json.dumps(text(out)))
`;
  await write('/tmp/crc-check.py', py);
  const r = JSON.parse((await ok(ctx, 'python3 -S /tmp/crc-check.py')).stdout);
  assert.deepEqual(r.check.map(BigInt), [0xe3069283n, 0xae8b14860a799888n, 0xcbf43926n], 'check values');
  const ab = Buffer.concat([a, b]);
  for (const alg of ['crc32', 'crc32c', 'crc64nvme']) {
    const want = { a: crcInt(a, alg), ab: crcInt(ab, alg) };
    const got = r[alg];
    assert.equal(BigInt(got.a), want.a, `${alg}(a)`);
    assert.equal(BigInt(got.ab), want.ab, `${alg}(b, ${alg}(a))`);
    assert.equal(BigInt(got.combined), want.ab, `combine_${alg}`);
    assert.equal(got.empty, '0', `${alg}(b"")`);
    assert.equal(BigInt(got.zero), want.a, `combine_${alg} with an empty B`);
    assert.equal(got.s3transfer, true, `s3transfer combines ${alg} with botocore.crc`);
  }
  const [digest, algorithms, def, hasCrt] = r.class;
  assert.equal(BigInt(`0x${digest}`), crcInt(ab, 'crc64nvme'), 'the crc64nvme checksum class');
  assert.deepEqual(algorithms, ['crc32', 'crc32c', 'crc64nvme', 'sha1', 'sha256', 'sha512']);
  assert.equal(def, 'CRC32');
  assert.equal(hasCrt, false);
  console.log(`botocore.crc: CRC32C/CRC64NVME check values, ${a.length}+${b.length} random bytes chained and combined as Node computes them; checksum classes ${algorithms.join(', ')}; default ${def}`);
}
