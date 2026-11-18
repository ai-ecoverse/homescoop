import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { awsResponder } from './lib/fake-aws.mjs';
import { clearLog, fixture, keyEnv, ok, requests, setState, sh } from './lib/aws.mjs';

// CloudTrail's signature checks, RSA PKCS#1 v1.5 with SHA-256 through
// awscrt.crypto.RSA.verify on cryptography (src/awscrt), against the fakes
// of CloudTrail (ListPublicKeys) and S3:
//  - verify-query-results on a CloudTrail Lake export signed by CloudTrail
//    itself: the AWS CLI's own test data (tests/functional/cloudtrail/
//    test_resource: result_sign.json, result_1.csv.gz, and the public key
//    with fingerprint 67b9fa73…), from a local directory and from S3. A
//    changed export file is a hash mismatch, a changed signature "Invalid
//    signature in sign file", and a key that isn't PKCS#1 DER fails to load.
//  - validate-logs on a chain of two digest files and their log files, built
//    here as CloudTrail delivers them (gzip, the signature in the object's
//    metadata) and signed in Node with the AWS CLI's CloudTrail test key
//    (test_resource/sample_private_key.pem): both digests and logs valid,
//    rc 0; a changed log is "hash value doesn't match" and a changed digest
//    signature "signature verification failed", rc 1.
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const b64 = (b) => Buffer.from(b).toString('base64');
const ACCOUNT = '123456789012';
const TRAIL = `arn:aws:cloudtrail:us-east-1:${ACCOUNT}:trail/cert`;
const BUCKET = 'cert-trail';

function trail() {
  const key = createPrivateKey(readFileSync(fixture('cloudtrail/sample_private_key.pem')));
  const objects = {};
  const digests = [];
  let previous = null;
  for (const [n, start, end] of [[1, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'], [2, '2026-01-01T01:00:00Z', '2026-01-01T02:00:00Z']]) {
    const log = Buffer.from(JSON.stringify({ Records: [{ eventVersion: '1.08', eventName: `CertEvent${n}`, eventTime: start, awsRegion: 'us-east-1' }] }));
    const logKey = `AWSLogs/${ACCOUNT}/CloudTrail/us-east-1/2026/01/01/${ACCOUNT}_CloudTrail_us-east-1_${end.replace(/[-:]/g, '').slice(0, 13)}Z_cert${n}.json.gz`;
    objects[`${BUCKET}/${logKey}`] = { bytes: b64(gzipSync(log)) };
    const digestKey = `AWSLogs/${ACCOUNT}/CloudTrail-Digest/us-east-1/2026/01/01/${ACCOUNT}_CloudTrail-Digest_us-east-1_cert_us-east-1_${end.replace(/[-:]/g, '')}.json.gz`;
    const digest = Buffer.from(JSON.stringify({
      awsAccountId: ACCOUNT,
      digestStartTime: start,
      digestEndTime: end,
      digestS3Bucket: BUCKET,
      digestS3Object: digestKey,
      digestPublicKeyFingerprint: 'cert-fingerprint',
      digestSignatureAlgorithm: 'SHA256withRSA',
      newestEventTime: start,
      oldestEventTime: start,
      previousDigestS3Bucket: previous ? BUCKET : null,
      previousDigestS3Object: previous ? previous.key : null,
      previousDigestHashValue: previous ? previous.hash : null,
      previousDigestHashAlgorithm: previous ? 'SHA-256' : null,
      previousDigestSignature: previous ? previous.signature : null,
      logFiles: [{ s3Bucket: BUCKET, s3Object: logKey, hashValue: sha256(log), hashAlgorithm: 'SHA-256', newestEventTime: start, oldestEventTime: start }],
    }));
    const toSign = `${end}\n${BUCKET}/${digestKey}\n${sha256(digest)}\n${previous ? previous.signature : 'null'}`;
    const signature = sign('sha256', Buffer.from(toSign), key).toString('hex');
    objects[`${BUCKET}/${digestKey}`] = { bytes: b64(gzipSync(digest)), meta: [['x-amz-meta-signature', signature], ['x-amz-meta-signature-algorithm', 'SHA256withRSA']] };
    previous = { key: digestKey, hash: sha256(digest), signature };
    digests.push({ key: digestKey, logKey, signature });
  }
  return { objects, digests };
}

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);
  const aws = (args) => `${keyEnv} aws ${args} </dev/null`;

  // verify-query-results: CloudTrail's own signature on a Lake export.
  const lake = JSON.parse(readFileSync(fixture('cloudtrail/lake-public-key.json'), 'utf8'));
  const signFile = readFileSync(fixture('cloudtrail/result_sign.json'));
  const csv = readFileSync(fixture('cloudtrail/result_1.csv.gz'));
  await write('/tmp/lake/result_sign.json', signFile);
  await write('/tmp/lake/result_1.csv.gz', csv);
  const lakeKey = { Fingerprint: lake.fingerprint, Value: lake.value, ValidityStartTime: 1640995200, ValidityEndTime: 1672531200 };
  await setState(ctx, {
    publicKeys: [lakeKey],
    objects: { 'cert-lake/export/result_sign.json': { bytes: b64(signFile) }, 'cert-lake/export/result_1.csv.gz': { bytes: b64(csv) } },
  });
  await clearLog(ctx);
  for (const where of ['--local-export-path /tmp/lake', '--s3-bucket cert-lake --s3-prefix export/']) {
    const r = await ok(ctx, aws(`cloudtrail verify-query-results ${where}`));
    assert.equal(r.stdout, 'Successfully validated sign and query result files\n', `${where}: ${r.stdout}${r.stderr}`);
  }
  const listed = (await requests(ctx)).filter((q) => /\.ListPublicKeys$/.test((q.headers.find(([k]) => k.toLowerCase() === 'x-amz-target') || [])[1] || ''));
  assert.equal(listed.length, 2, 'ListPublicKeys once per run');
  const bad = async (what, args, re) => {
    const r = await sh(ctx, aws(args));
    assert.notEqual(r.status, 0, `${what}: rc 0\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, re, `${what}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Traceback|Missing Dependency|awscrt/, `${what}: ${r.stderr}`);
  };
  const tampered = Buffer.from(csv);
  tampered[tampered.length - 9] ^= 1;
  await write('/tmp/lake-file/result_sign.json', signFile);
  await write('/tmp/lake-file/result_1.csv.gz', tampered);
  await bad('a changed export file', 'cloudtrail verify-query-results --local-export-path /tmp/lake-file', /File result_1\.csv\.gz has inconsistent hash value/);
  const forged = JSON.parse(signFile);
  forged.hashSignature = `${forged.hashSignature.slice(0, -2)}${forged.hashSignature.endsWith('00') ? '01' : '00'}`;
  await write('/tmp/lake-sig/result_sign.json', JSON.stringify(forged));
  await write('/tmp/lake-sig/result_1.csv.gz', csv);
  await bad('a changed signature', 'cloudtrail verify-query-results --local-export-path /tmp/lake-sig', /Invalid signature in sign file/);
  await setState(ctx, { publicKeys: [{ ...lakeKey, Value: b64('not a key') }] });
  await bad('a public key that is not PKCS#1 DER', 'cloudtrail verify-query-results --local-export-path /tmp/lake', /Sign file invalid, unable to load PKCS #1 key/);

  // validate-logs: a digest chain, as CloudTrail delivers it.
  const { objects, digests } = trail();
  const sample = readFileSync(fixture('cloudtrail/sample_public_key.der'));
  await setState(ctx, { objects, publicKeys: [{ Fingerprint: 'cert-fingerprint', Value: b64(sample), ValidityStartTime: 1767225600, ValidityEndTime: 1767312000 }] });
  const validate = `cloudtrail validate-logs --trail-arn ${TRAIL} --s3-bucket ${BUCKET} --start-time 2026-01-01T00:00:00Z --end-time 2026-01-01T02:30:00Z --verbose`;
  const good = await ok(ctx, aws(validate));
  for (const d of digests) {
    assert.match(good.stdout, new RegExp(`^Digest file\\ts3://${BUCKET}/${d.key.replace(/[.]/g, '\\.')}\\tvalid$`, 'm'), good.stdout);
    assert.match(good.stdout, new RegExp(`^Log file\\ts3://${BUCKET}/${d.logKey.replace(/[.]/g, '\\.')}\\tvalid$`, 'm'), good.stdout);
  }
  assert.match(good.stdout, /^2\/2 digest files valid$/m, good.stdout);
  assert.match(good.stdout, /^2\/2 log files valid$/m, good.stdout);

  const [first, second] = digests;
  await setState(ctx, { objects: { [`${BUCKET}/${first.logKey}`]: { bytes: b64(gzipSync(Buffer.from('{"Records":[{"eventName":"Forged"}]}'))) } } });
  const log = await sh(ctx, aws(validate));
  assert.equal(log.status, 1, `a changed log: rc=${log.status}\n${log.stdout}${log.stderr}`);
  assert.match(log.stderr, new RegExp(`Log file\\ts3://${BUCKET}/${first.logKey.replace(/[.]/g, '\\.')}\\tINVALID: hash value doesn't match`), log.stderr);
  assert.match(log.stdout, /^2\/2 digest files valid$/m, log.stdout);
  await setState(ctx, { objects: { ...objects, [`${BUCKET}/${second.key}`]: { ...objects[`${BUCKET}/${second.key}`], meta: [['x-amz-meta-signature', `${second.signature.slice(0, -2)}00`], ['x-amz-meta-signature-algorithm', 'SHA256withRSA']] } } });
  const sig = await sh(ctx, aws(validate));
  assert.equal(sig.status, 1, `a changed digest signature: rc=${sig.status}\n${sig.stdout}${sig.stderr}`);
  assert.match(sig.stderr, new RegExp(`Digest file\\ts3://${BUCKET}/${second.key.replace(/[.]/g, '\\.')}\\tINVALID: signature verification failed`), sig.stderr);
  assert.doesNotMatch(sig.stderr, /Traceback/, sig.stderr);
  console.log('cloudtrail: verify-query-results validates the AWS CLI\'s CloudTrail-signed Lake export (local and S3) and refuses a changed file, signature or key; validate-logs validates a 2-digest chain and its logs signed with the CLI\'s test key, and refuses a changed log and a changed digest signature');
}
