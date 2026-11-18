// Checks a logged request's SigV4 or SigV4a signature in Node, from the
// request the fake server received (method, URL, the signed headers, the
// body) and the credentials. Not the code under test: botocore signed it in
// the kernel.
import { createECDH, createHash, createHmac, createPublicKey, verify } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The canonical request for the headers in `signed`, with the query
// (without X-Amz-Signature, for a presigned URL) and the payload hash
// (x-amz-content-sha256, else `payload`, else the body's SHA-256).
function canonicalRequest(req, signed, { doubleEncode, payload }) {
  const u = new URL(req.url);
  const get = (n) => (n === 'host' ? u.host : (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1]);
  const names = signed.split(';');
  const canonHeaders = names.map((n) => `${n}:${String(get(n) ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const path = doubleEncode ? u.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/') : u.pathname;
  const query = [...u.searchParams].filter(([k]) => k !== 'X-Amz-Signature').map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const body = Buffer.from(req.body || '', 'base64');
  return [req.method, path || '/', query, canonHeaders, signed, get('x-amz-content-sha256') || payload || sha256(body)].join('\n');
}

export function verifySigV4(req, secret, { doubleEncode = true } = {}) {
  const auth = (req.headers.find(([k]) => k.toLowerCase() === 'authorization') || [])[1] || '';
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return { ok: false, why: `not a SigV4 Authorization header: ${auth}` };
  const [, key, date, region, service, signed, signature] = m;
  const canonical = canonicalRequest(req, signed, { doubleEncode });
  const amzDate = (req.headers.find(([k]) => k.toLowerCase() === 'x-amz-date') || [])[1];
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let k = hmac(`AWS4${secret}`, date);
  for (const part of [region, service, 'aws4_request']) k = hmac(k, part);
  const want = createHmac('sha256', k).update(toSign).digest('hex');
  return { ok: want === signature, key, date, region, service, signed, why: want === signature ? '' : `signature ${signature}, expected ${want}\n${canonical}` };
}

// SigV4a's key from the credentials (the AWS signing spec, aws-c-auth's
// key_derivation.c): HMAC-SHA256 counter-mode KDF keyed with "AWS4A" + the
// secret, the first value k0 <= n - 2 gives the private key k0 + 1.
const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
export function sigV4aPublicKey(accessKey, secret) {
  for (let counter = 1; counter < 255; counter++) {
    const fixed = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('AWS4-ECDSA-P256-SHA256'), Buffer.from([0]), Buffer.from(accessKey), Buffer.from([counter]), Buffer.from([0, 0, 1, 0])]);
    const k0 = BigInt(`0x${hmac(`AWS4A${secret}`, fixed).toString('hex')}`);
    if (k0 > N - 2n) continue;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from((k0 + 1n).toString(16).padStart(64, '0'), 'hex'));
    const pub = ecdh.getPublicKey();
    const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
    return { key: createPublicKey({ key: jwk, format: 'jwk' }), x: pub.subarray(1, 33).toString('hex'), y: pub.subarray(33).toString('hex') };
  }
  throw new Error('no SigV4a key');
}

// A SigV4a request, signed in the Authorization header or presigned in the
// query: its scope, region set and signature (ECDSA P-256 over SHA-256, DER).
export function verifySigV4a(req, accessKey, secret, { doubleEncode = false } = {}) {
  const u = new URL(req.url);
  const header = (n) => (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1];
  const auth = header('authorization') || '';
  let key, date, service, signed, signature, regionSet, amzDate, payload;
  const m = /^AWS4-ECDSA-P256-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(auth);
  if (m) {
    [, key, date, service, signed, signature] = m;
    regionSet = header('x-amz-region-set');
    amzDate = header('x-amz-date');
  } else if (u.searchParams.get('X-Amz-Algorithm') === 'AWS4-ECDSA-P256-SHA256') {
    [key, date, service] = u.searchParams.get('X-Amz-Credential').split('/');
    signed = u.searchParams.get('X-Amz-SignedHeaders');
    signature = u.searchParams.get('X-Amz-Signature');
    regionSet = u.searchParams.get('X-Amz-Region-Set');
    amzDate = u.searchParams.get('X-Amz-Date');
    payload = 'UNSIGNED-PAYLOAD';
  } else {
    return { ok: false, why: `not SigV4a: ${auth || u.search}` };
  }
  const canonical = canonicalRequest(req, signed, { doubleEncode, payload });
  const toSign = ['AWS4-ECDSA-P256-SHA256', amzDate, `${date}/${service}/aws4_request`, sha256(canonical)].join('\n');
  const ok = key === accessKey && verify('sha256', Buffer.from(toSign), sigV4aPublicKey(accessKey, secret).key, Buffer.from(signature, 'hex'));
  return { ok, key, date, service, signed, regionSet, why: ok ? '' : `the signature does not verify\n${canonical}` };
}
