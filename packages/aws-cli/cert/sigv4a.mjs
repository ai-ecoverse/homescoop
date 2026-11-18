import { readFileSync } from 'node:fs';
import { createHash, verify } from 'node:crypto';
import { awsResponder } from './lib/fake-aws.mjs';
import { KEYS, PKG, clearLog, fixture, keyEnv, ok, requests, setState } from './lib/aws.mjs';
import { sigV4aPublicKey, verifySigV4a } from './lib/sigv4.mjs';

// SigV4a (AWS4-ECDSA-P256-SHA256) without awscrt: botocore/sigv4a.py,
// botocore's SigV4 signers with SigV4a's scope, region set and ECDSA key on
// cryptography (awscrt-optional.patch).
//  - aws-c-auth's SigV4a test suite (cert/fixtures/sigv4a-suite.json, the
//    vectors awscrt's signer is tested with), signed in the kernel by
//    lib/sigv4a_suite.py: the key derived from the suite's credentials is
//    the suite's public key; the canonical requests and strings to sign are
//    the suite's, for the Authorization header and for a presigned URL; the
//    Authorization header and the presigned query are the suite's but for
//    the signature, which (ECDSA being randomized) is checked by verifying
//    it in Node with the suite's key. The suite's tests botocore has no
//    signer for are listed with the reason (sigv4a_suite.py).
//  - An S3 multi-region access point, end to end: s3api get-object and
//    put-object on its ARN are signed with SigV4a for the region set "*"
//    and the fake (which takes SigV4a only there) answers; aws s3 presign
//    gives a SigV4a URL that the fake serves. Node derives the key from the
//    access keys on its own and verifies each signature.
const MRAP = 'arn:aws:s3::123456789012:accesspoint/mfzwi23gnjvgw.mrap';
const HOST = 'mfzwi23gnjvgw.mrap.accesspoint.s3-global.amazonaws.com';
const sha = (b) => createHash('sha256').update(b).digest('hex');

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);

  const suite = JSON.parse(readFileSync(fixture('sigv4a-suite.json'), 'utf8')).tests;
  await write('/tmp/sigv4a_suite.py', readFileSync(new URL('./lib/sigv4a_suite.py', import.meta.url)));
  await write('/tmp/sigv4a-suite.json', readFileSync(fixture('sigv4a-suite.json')));
  const results = JSON.parse((await ok(ctx, `python3 -S /tmp/sigv4a_suite.py ${PKG}/bin/aws /tmp/sigv4a-suite.json`)).stdout);
  let headers = 0, query = 0;
  const skipped = [];
  for (const [name, t] of Object.entries(suite)) {
    const r = results[name];
    assert.ok(r, `${name}: no result`);
    if (r.skip) {
      skipped.push(`${name} (${r.skip})`);
      continue;
    }
    const c = t.context.credentials;
    const pub = sigV4aPublicKey(c.access_key_id, c.secret_access_key);
    assert.deepEqual(r.publicKey, { X: t.publicKey.X.toLowerCase(), Y: t.publicKey.Y.toLowerCase() }, `${name}: the derived key`);
    assert.deepEqual([pub.x, pub.y], [r.publicKey.X, r.publicKey.Y], `${name}: Node's derivation`);
    // The header variant.
    assert.equal(r.header.canonical, t.headerCanonicalRequest, `${name}: canonical request`);
    assert.equal(r.header.stringToSign, t.headerStringToSign, `${name}: string to sign`);
    const auth = (r.header.headers.find(([k]) => k === 'Authorization') || [])[1];
    const want = /^Authorization:(AWS4-ECDSA-P256-SHA256 Credential=\S+, SignedHeaders=\S+, Signature=)[0-9a-f]+$/m.exec(t.headerSignedRequest)[1];
    assert.ok(auth.startsWith(want), `${name}: ${auth}\nwant ${want}…`);
    assert.ok(verify('sha256', Buffer.from(t.headerStringToSign), pub.key, Buffer.from(auth.slice(want.length), 'hex')), `${name}: the header signature does not verify`);
    assert.ok(verify('sha256', Buffer.from(t.headerStringToSign), pub.key, Buffer.from(t.headerSignature.trim(), 'hex')), `${name}: the suite's own signature`);
    headers += 1;
    if (r.querySkip) {
      skipped.push(`${name}, presigned (${r.querySkip})`);
      continue;
    }
    assert.equal(r.query.canonical, t.queryCanonicalRequest, `${name}: presigned canonical request`);
    assert.equal(r.query.stringToSign, t.queryStringToSign, `${name}: presigned string to sign`);
    const got = new URL(r.query.url).searchParams;
    const exp = new URLSearchParams(/^\S+ [^?]*\?(.*) HTTP\/1\.1$/m.exec(t.querySignedRequest)[1]);
    const params = (sp) => [...sp].filter(([k]) => k !== 'X-Amz-Signature').sort().map((p) => p.join('='));
    assert.deepEqual(params(got), params(exp), `${name}: presigned query`);
    assert.ok(verify('sha256', Buffer.from(t.queryStringToSign), pub.key, Buffer.from(got.get('X-Amz-Signature'), 'hex')), `${name}: the presigned signature does not verify`);
    query += 1;
  }
  assert.ok(headers >= 30 && query >= 27, `${headers} header and ${query} presigned tests`);

  // A multi-region access point: SigV4a for the region set "*".
  const body = Buffer.from('a multi-region object\n');
  await setState(ctx, { objects: { 'mrap-mfzwi23gnjvgw/k.txt': { bytes: body.toString('base64') } } });
  await clearLog(ctx);
  await ok(ctx, `${keyEnv} aws s3api get-object --bucket ${MRAP} --key k.txt /tmp/mrap-out.txt`);
  assert.equal(await ctx.read('/tmp/mrap-out.txt'), body.toString());
  await write('/tmp/mrap-up.txt', 'uploaded through the MRAP\n');
  await ok(ctx, `${keyEnv} aws s3api put-object --bucket ${MRAP} --key up.txt --body /tmp/mrap-up.txt`);
  const log = await requests(ctx);
  assert.deepEqual(log.map((q) => `${q.method} ${q.url}`), [`GET https://${HOST}/k.txt`, `PUT https://${HOST}/up.txt`]);
  for (const q of log) {
    const v = verifySigV4a(q, KEYS.AWS_ACCESS_KEY_ID, KEYS.AWS_SECRET_ACCESS_KEY);
    assert.ok(v.ok, `${q.method} ${q.url}: ${v.why}`);
    assert.equal(v.regionSet, '*');
    assert.equal(v.service, 's3');
    assert.match(v.signed, /(^|;)x-amz-region-set(;|$)/);
  }
  assert.equal(sha(Buffer.from(log[1].decoded, 'base64')), sha(Buffer.from('uploaded through the MRAP\n')), 'the uploaded bytes');

  const url = (await ok(ctx, `${keyEnv} aws s3 presign s3://${MRAP}/k.txt --expires-in 600`)).stdout.trim();
  const u = new URL(url);
  assert.equal(u.host, HOST);
  assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-ECDSA-P256-SHA256');
  assert.equal(u.searchParams.get('X-Amz-Region-Set'), '*');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
  await clearLog(ctx);
  const got = await ok(ctx, `python3 -S -c 'import sys, urllib.request; sys.stdout.write(urllib.request.urlopen(sys.argv[1]).read().decode())' '${url}'`);
  assert.equal(got.stdout, body.toString());
  const [fetched] = await requests(ctx);
  const v = verifySigV4a(fetched, KEYS.AWS_ACCESS_KEY_ID, KEYS.AWS_SECRET_ACCESS_KEY);
  assert.ok(v.ok, `the presigned URL: ${v.why}`);
  console.log(`SigV4a: aws-c-auth's suite, ${headers} header and ${query} presigned tests (keys, canonical requests, strings to sign; signatures verified in Node); skipped: ${skipped.join('; ')}. An MRAP: get-object, put-object and a presigned URL, SigV4a for "*", verified in Node`);
}
