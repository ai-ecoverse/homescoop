// Reference CRCs for the specs, computed in Node (not by the code under test):
// CRC-32 (zlib), CRC-32C (Castagnoli) and CRC-64/NVME, table-driven from
// their published reflected polynomials, as base64 of the big-endian value
// (the encoding of S3's x-amz-checksum-* headers).
const PARAMS = {
  crc32: [32, 0xedb88320n],
  crc32c: [32, 0x82f63b78n],
  crc64nvme: [64, 0x9a6c9329ac4bc9b5n],
};
const TABLES = {};

function table(alg) {
  if (TABLES[alg]) return TABLES[alg];
  const [, poly] = PARAMS[alg];
  const t = [];
  for (let n = 0n; n < 256n; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ poly : c >> 1n;
    t.push(c);
  }
  return (TABLES[alg] = t);
}

export function crcInt(bytes, alg) {
  const [width] = PARAMS[alg];
  const t = table(alg);
  const mask = (1n << BigInt(width)) - 1n;
  let c = mask;
  for (const b of bytes) c = t[Number((c ^ BigInt(b)) & 0xffn)] ^ (c >> 8n);
  return c ^ mask;
}

export function crcB64(bytes, alg) {
  let v = crcInt(bytes, alg);
  const out = Buffer.alloc(PARAMS[alg][0] / 8);
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out.toString('base64');
}
