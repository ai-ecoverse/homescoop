import { createHash, randomBytes } from 'node:crypto';
import { awsResponder } from './lib/fake-aws.mjs';
import { KEYS, clearLog, header, keyEnv, ok, requests, sh } from './lib/aws.mjs';
import { crcB64 } from './lib/crc.mjs';
import { verifySigV4 } from './lib/sigv4.mjs';

// S3 through the kernel's network with the classic transfer client (there's
// no awscrt, so no CRT client: awscrt-optional.patch), against the fake in
// cert/lib/fake-aws.mjs. Uploads send CRC32 by default (zlib) and CRC32C or
// CRC64NVME when asked (pure Python), each the value Node computes; xxhash
// says it needs awscrt. Downloads validate the object's checksum, a wrong
// one fails; a download in ranged parts combines the parts' CRC64NVME into
// the full-object checksum. Multipart uploads run their parts in threads.
const sha = (b) => createHash('sha256').update(b).digest('hex');

export default async function (ctx) {
  const { assert, write, readBytes } = ctx;
  await ctx.serve(awsResponder);
  const aws = (args) => `${keyEnv} aws ${args}`;

  const ls = await ok(ctx, aws('s3 ls'));
  assert.match(ls.stdout, /^2026-01-01 \d\d:\d\d:\d\d cert-bucket$/m, ls.stdout);

  // A small upload: aws-chunked with a CRC32 trailer, unsigned payload over TLS.
  const small = Buffer.from('hello from slicc\n');
  await write('/tmp/s3-small.txt', small);
  await clearLog(ctx);
  await ok(ctx, aws('s3 cp /tmp/s3-small.txt s3://cert-bucket/small.txt'));
  let [put] = (await requests(ctx)).filter((q) => q.method === 'PUT');
  assert.equal(put.url, 'https://cert-bucket.s3.us-east-1.amazonaws.com/small.txt');
  assert.equal(header(put, 'x-amz-sdk-checksum-algorithm'), 'CRC32');
  assert.equal(put.checksums.crc32, crcB64(small, 'crc32'), 'CRC32 trailer');
  assert.equal(Buffer.from(put.decoded, 'base64').toString(), small.toString());
  assert.ok(verifySigV4(put, KEYS.AWS_SECRET_ACCESS_KEY, { doubleEncode: false }).ok, 'PutObject SigV4');

  // CRC32C and CRC64NVME on request (pure Python), xxhash refused.
  const body = randomBytes(300007);
  await write('/tmp/s3-body.bin', body);
  for (const [alg, key] of [['CRC32C', 'c32c.bin'], ['CRC64NVME', 'c64.bin'], ['CRC64NVME', 'tampered.bin']]) {
    await clearLog(ctx);
    await ok(ctx, aws(`s3api put-object --bucket cert-bucket --key ${key} --body /tmp/s3-body.bin --checksum-algorithm ${alg}`));
    [put] = (await requests(ctx)).filter((q) => q.method === 'PUT');
    assert.equal(put.checksums[alg.toLowerCase()], crcB64(body, alg.toLowerCase()), `${alg} of ${key}`);
  }
  const xx = await sh(ctx, aws('s3api put-object --bucket cert-bucket --key xx --body /tmp/s3-small.txt --checksum-algorithm XXHASH64'));
  assert.equal(xx.status, 255, `${xx.stdout}${xx.stderr}`);
  assert.match(xx.stderr, /Missing Dependency: The XXHASH64 checksum algorithm requires awscrt/, xx.stderr);

  // Downloads validate the object's CRC64NVME; a wrong one fails.
  await clearLog(ctx);
  await ok(ctx, aws('s3 cp s3://cert-bucket/c64.bin /tmp/s3-c64.bin'));
  assert.equal(sha(await readBytes('/tmp/s3-c64.bin')), sha(body));
  const get = (await requests(ctx)).find((q) => q.method === 'GET');
  assert.match(header(get, 'x-amz-checksum-mode') || '', /ENABLED/i, 'downloads ask for the checksum');
  const bad = await sh(ctx, aws('s3 cp s3://cert-bucket/tampered.bin /tmp/s3-tampered.bin'));
  assert.equal(bad.status, 1, `${bad.stdout}${bad.stderr}`);
  assert.match(bad.stdout + bad.stderr, /did not match calculated checksum/, bad.stdout + bad.stderr);
  const lsk = await ok(ctx, aws('s3 ls s3://cert-bucket/'));
  assert.match(lsk.stdout, /300007 c64\.bin/, lsk.stdout);

  // Multipart: 5 MiB parts. An upload of 11 MiB + 1 sends three parts,
  // each with its CRC32, from the transfer manager's threads.
  await ok(ctx, 'aws configure set default.s3.multipart_threshold 5MB && aws configure set default.s3.multipart_chunksize 5MB');
  const big = randomBytes(11 * 1024 * 1024 + 1);
  await write('/tmp/s3-big.bin', big);
  await clearLog(ctx);
  await ok(ctx, aws('s3 cp /tmp/s3-big.bin s3://cert-bucket/big.bin'));
  const log = await requests(ctx);
  const parts = log.filter((q) => q.method === 'PUT' && /[?&]partNumber=/.test(q.url));
  assert.equal(parts.length, 3, log.map((q) => `${q.method} ${q.url}`).join('\n'));
  for (const p of parts) {
    const n = Number(new URL(p.url).searchParams.get('partNumber'));
    const slice = big.subarray((n - 1) * 5 * 1024 * 1024, n * 5 * 1024 * 1024);
    assert.equal(p.checksums.crc32, crcB64(slice, 'crc32'), `part ${n} CRC32`);
  }
  assert.ok(log.some((q) => q.method === 'POST' && /[?&]uploads/.test(q.url)), 'CreateMultipartUpload');
  assert.ok(log.some((q) => q.method === 'POST' && /[?&]uploadId=/.test(q.url)), 'CompleteMultipartUpload');

  // A ranged download of a single-part CRC64NVME object larger than the
  // threshold: the parts' checksums are combined and checked against it.
  const six = randomBytes(6 * 1024 * 1024 + 3);
  await write('/tmp/s3-six.bin', six);
  await ok(ctx, aws('s3api put-object --bucket cert-bucket --key six.bin --body /tmp/s3-six.bin --checksum-algorithm CRC64NVME'));
  await ok(ctx, aws('s3api put-object --bucket cert-bucket --key six-tampered.bin --body /tmp/s3-six.bin --checksum-algorithm CRC64NVME'));
  await clearLog(ctx);
  await ok(ctx, aws('s3 cp s3://cert-bucket/six.bin /tmp/s3-six-down.bin --debug 2>/tmp/s3-six-debug.txt'));
  assert.equal(sha(await readBytes('/tmp/s3-six-down.bin')), sha(six));
  const ranged = (await requests(ctx)).filter((q) => q.method === 'GET' && header(q, 'range'));
  assert.equal(ranged.length, 2, 'two ranged GETs');
  const debug = (await ok(ctx, 'cat /tmp/s3-six-debug.txt')).stdout;
  assert.match(debug, /Full object crc64nvme checksum validated/, 'the combined checksum was checked');
  const badSix = await sh(ctx, aws('s3 cp s3://cert-bucket/six-tampered.bin /tmp/s3-six-bad.bin'));
  assert.equal(badSix.status, 1, `${badSix.stdout}${badSix.stderr}`);
  assert.match(badSix.stdout + badSix.stderr, /did not match/, badSix.stdout + badSix.stderr);
  await ok(ctx, 'rm -rf ~/.aws');
  console.log('s3: ls, cp up (CRC32 trailer) and down (CRC64NVME validated, a wrong one rc 1), put-object CRC32C/CRC64NVME as Node computes them, XXHASH64 needs awscrt; multipart upload of 3 parts with CRC32 each; ranged download with the full-object CRC64NVME combined and checked');
}
