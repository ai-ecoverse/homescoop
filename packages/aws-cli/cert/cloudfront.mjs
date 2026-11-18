import { createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { awsMany, fixture, sh } from './lib/aws.mjs';

// aws cloudfront sign and sign-cookies: RSA PKCS#1 v1.5 (SHA-1, the default,
// and SHA-256) and ECDSA P-256 signatures of the CloudFront policy, through
// awscrt.crypto's RSA and EC on cryptography (src/awscrt). The cases are the
// AWS CLI's own cross-SDK ones (tests/functional/cloudfront/testdata,
// test_sign_shared_cases.py), run the same way: each command's URL or
// cookies must carry the expected parameters and policy; an RSA signature,
// which is deterministic, must be the expected one byte for byte, and every
// signature must verify in Node with the test key's public key; the error
// cases (an ECDSA key asked for SHA-1, a DSA key, JSON injection, bad dates)
// fail with their rc and message, without a traceback. Nothing is sent. The
// cases run in one python (lib/aws_many.py, bin/aws's setup and the CLI's
// entry point); three of them run as aws commands too, with the same results.
const TESTDATA = '/tmp/cloudfront-testdata';
const ARGS = { expirationDate: '--date-less-than', activeDate: '--date-greater-than', ipRange: '--ip-address', hashAlgorithm: '--hash-algorithm' };
const PUBLIC = { K1TESTKEY: 'test-rsa-key-public.pem', K2ECDSATEST: 'test-ecdsa-key-public.pem' };
const HASH = { 'RSA-SHA1': 'sha1', 'RSA-SHA256': 'sha256', 'ECDSA-SHA256': 'sha256' };
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const unb64 = (v) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');
const cases = (f) => JSON.parse(readFileSync(fixture(`cloudfront/${f}`), 'utf8'));

function argv(kind, c) {
  const i = c.input;
  const args = kind === 'sign'
    ? ['cloudfront', 'sign', '--url', c.expected.applyTo ?? i.resource, ...(c.expected.applyTo ? ['--policy-resource', i.resource] : [])]
    : ['cloudfront', 'sign-cookies', '--resource', i.resource, '--output', 'json'];
  args.push('--key-pair-id', i.keyPairId, '--private-key', `file://${TESTDATA}/${i.privateKeyFile}`);
  for (const [name, flag] of Object.entries(ARGS)) if (name in i) args.push(flag, String(i[name]));
  return args;
}

function checkSignature(assert, c, signature, expected) {
  const key = createPublicKey(readFileSync(fixture(`cloudfront/${PUBLIC[c.input.keyPairId]}`)));
  const policy = Buffer.from(c.expected.policyJson);
  assert.ok(verify(HASH[c.expected.signatureAlgorithm], policy, key, unb64(signature)), `${c.id}: the signature does not verify`);
  if (!c.expected.verifyCryptographically) assert.equal(signature, expected, `${c.id}: the RSA signature`);
}

export default async function (ctx) {
  const { assert, write } = ctx;
  for (const f of readdirSync(fixture('cloudfront/'))) {
    if (f.endsWith('.pem')) await write(`${TESTDATA}/${f}`, readFileSync(fixture(`cloudfront/${f}`)));
  }
  const all = [
    ...cases('sign-test-cases.json').map((c) => ['sign', c]),
    ...cases('sign-cookies-test-cases.json').map((c) => ['sign-cookies', c]),
  ];
  const results = await awsMany(ctx, all.map(([kind, c]) => argv(kind, c)), { env: '' });
  // As aws commands: a canned RSA-SHA1 URL, an ECDSA (SEC1 key) URL and the DSA key error.
  for (const id of ['canned-policy-url-basic', 'ecdsa-canned-policy-url-sec1', 'error-unsupported-key-type']) {
    const n = all.findIndex(([kind, c]) => kind === 'sign' && c.id === id);
    const r = await sh(ctx, `aws ${argv(...all[n]).map(q).join(' ')} </dev/null`);
    assert.equal(r.status, results[n].rc, `aws cloudfront sign (${id}): rc=${r.status}\n${r.stdout}${r.stderr}`);
    if (id.startsWith('canned')) assert.equal(r.stdout, results[n].stdout, id);
    else results[n] = { rc: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  let urls = 0, cookies = 0, errors = 0;
  for (const [n, [kind, c]] of all.entries()) {
    const { rc, stdout, stderr } = results[n];
    const e = c.expected;
    const what = `${kind} ${c.id}: rc=${rc}\n${stdout}${stderr}`;
    if (e.error) {
      assert.equal(rc, e.returnCode, what);
      assert.equal(stdout, '', what);
      assert.doesNotMatch(stderr, /Traceback|Missing Dependency/, what);
      for (const term of e.errorContains) assert.ok(stderr.toLowerCase().includes(term.toLowerCase()), `${what}\n(no "${term}")`);
      errors += 1;
    } else if (kind === 'sign') {
      assert.equal(rc, 0, what);
      const base = e.applyTo ?? c.input.resource;
      assert.ok(stdout.startsWith(base + (base.includes('?') ? '&' : '?')), what);
      const params = Object.fromEntries(new URL(stdout).search.slice(1).split('&').map((p) => p.split(/=(.*)/s).slice(0, 2)));
      const names = new Set([...Object.keys(e.queryParams), 'Signature']);
      for (const [k, v] of Object.entries(e.queryParams)) assert.equal(params[k], v, `${what}\n(${k})`);
      if (!('Expires' in e.queryParams)) {
        names.add('Policy');
        assert.equal(unb64(params.Policy).toString(), e.policyJson, what);
      }
      assert.deepEqual(new Set(Object.keys(params)), names, what);
      checkSignature(assert, c, params.Signature, e.signature);
      urls += 1;
    } else {
      assert.equal(rc, 0, what);
      const got = JSON.parse(stdout);
      for (const [k, v] of Object.entries(e.cookies)) if (k !== 'CloudFront-Signature') assert.equal(got[k], v, `${what}\n(${k})`);
      assert.deepEqual(new Set(Object.keys(got)), new Set([...Object.keys(e.cookies), 'CloudFront-Signature']), what);
      if (!('CloudFront-Expires' in e.cookies)) assert.equal(unb64(got['CloudFront-Policy']).toString(), e.policyJson, what);
      checkSignature(assert, c, got['CloudFront-Signature'], e.cookies['CloudFront-Signature']);
      cookies += 1;
    }
  }
  assert.ok(urls >= 10 && cookies >= 4 && errors >= 10, `${urls} URLs, ${cookies} cookies, ${errors} errors`);
  console.log(`cloudfront sign / sign-cookies: the AWS CLI's ${all.length} shared cases (${urls} signed URLs, ${cookies} signed cookies, ${errors} errors): RSA-SHA1, RSA-SHA256 (PKCS#1 and PKCS#8 keys) byte for byte, ECDSA P-256 (PKCS#8 and SEC1) verified in Node`);
}
