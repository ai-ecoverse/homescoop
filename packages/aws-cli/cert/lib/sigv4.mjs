// Checks a logged request's SigV4 signature in Node, from the request the
// fake server received (method, URL, the signed headers, the body) and the
// secret key. Not the code under test: botocore signed it in the kernel.
import { createHash, createHmac } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function verifySigV4(req, secret, { doubleEncode = true } = {}) {
  const auth = (req.headers.find(([k]) => k.toLowerCase() === 'authorization') || [])[1] || '';
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return { ok: false, why: `not a SigV4 Authorization header: ${auth}` };
  const [, key, date, region, service, signed, signature] = m;
  const u = new URL(req.url);
  const get = (n) => (n === 'host' ? u.host : (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1]);
  const names = signed.split(';');
  const canonHeaders = names.map((n) => `${n}:${String(get(n) ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const path = doubleEncode ? u.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/') : u.pathname;
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const body = Buffer.from(req.body, 'base64');
  const payload = get('x-amz-content-sha256') || sha256(body);
  const canonical = [req.method, path || '/', query, canonHeaders, signed, payload].join('\n');
  const amzDate = get('x-amz-date');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let k = hmac(`AWS4${secret}`, date);
  for (const part of [region, service, 'aws4_request']) k = hmac(k, part);
  const want = createHmac('sha256', k).update(toSign).digest('hex');
  return { ok: want === signature, key, date, region, service, signed, why: want === signature ? '' : `signature ${signature}, expected ${want}\n${canonical}` };
}
