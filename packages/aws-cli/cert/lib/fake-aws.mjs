// A small fake of the AWS endpoints the specs call, for ctx.serve(). It runs
// in the cert page (ctx.serve serialises it), so it is self-contained: no
// imports, no closures. State lives on globalThis:
//   awsCertLog      every request: { url, method, headers, body (base64), decoded }
//   awsCertObjects  S3 objects by "bucket/key": { bytes (base64), checksums, type }
//   awsCertUploads  multipart uploads by id: { bucket, key, parts: { n: base64 } }
//   awsCertTokens   CreateToken calls, so the first one is authorization_pending
// GET http://log.cert.test/ answers the log as JSON; DELETE empties it and
// starts the device flow over.
//
// STS: GetCallerIdentity answers the caller of the access key it was signed
// with (AccessDenied for AKIADENIEDEXAMPLE0000). S3 (virtual-hosted style):
// ListBuckets, PutObject (aws-chunked bodies and their trailers decoded),
// GetObject (Range too), HeadObject, ListObjectsV2, and multipart uploads.
// An object answers the checksum it was uploaded with, as S3 does when the
// request asks with x-amz-checksum-mode: ENABLED; a key with "tampered" in it
// answers a wrong one. SSO OIDC: RegisterClient, StartDeviceAuthorization,
// CreateToken (pending once, then a token); the SSO portal:
// GetRoleCredentials for that token.
export async function awsResponder(req) {
  const g = globalThis;
  g.awsCertLog = g.awsCertLog || [];
  g.awsCertObjects = g.awsCertObjects || {};
  g.awsCertUploads = g.awsCertUploads || {};
  g.awsCertTokens = g.awsCertTokens || 0;
  const u = new URL(req.url);
  const td = new TextDecoder();
  const te = new TextEncoder();
  const raw = req.body || new Uint8Array(0);
  const hdr = (n) => (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1] || '';
  const b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const xml = (status, body, headers = []) => ({ status, headers: [['content-type', 'application/xml'], ['x-amzn-requestid', 'cert-request'], ...headers], body });
  const json = (status, body, headers = []) => ({ status, headers: [['content-type', 'application/json'], ...headers], body: JSON.stringify(body) });
  const s3err = (status, code, message) => xml(status, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><RequestId>cert</RequestId></Error>`);

  if (u.hostname === 'log.cert.test') {
    if (req.method === 'DELETE') {
      g.awsCertLog = [];
      g.awsCertTokens = 0;
    }
    return json(200, g.awsCertLog);
  }

  // aws-chunked: <hex size>[;chunk-signature=…]\r\n<data>\r\n … 0\r\n<trailers>\r\n\r\n
  let body = raw;
  const trailers = {};
  if (/aws-chunked/.test(hdr('content-encoding'))) {
    const parts = [];
    let i = 0;
    const line = () => {
      let j = i;
      while (j + 1 < raw.length && !(raw[j] === 13 && raw[j + 1] === 10)) j++;
      const s = td.decode(raw.subarray(i, j));
      i = j + 2;
      return s;
    };
    for (;;) {
      const size = parseInt(line().split(';')[0], 16);
      if (!size) break;
      parts.push(raw.subarray(i, i + size));
      i += size + 2;
    }
    for (let t = line(); t; t = line()) {
      const c = t.indexOf(':');
      trailers[t.slice(0, c).trim().toLowerCase()] = t.slice(c + 1).trim();
    }
    body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { body.set(p, o); o += p.length; }
  }
  const checksums = {};
  for (const [k, v] of [...req.headers.map(([k, v]) => [k.toLowerCase(), v]), ...Object.entries(trailers)]) {
    const m = /^x-amz-checksum-(crc32|crc32c|crc64nvme|sha1|sha256)$/.exec(k);
    if (m) checksums[m[1]] = v;
  }
  g.awsCertLog.push({ url: req.url, method: req.method, headers: req.headers, body: b64(raw), decoded: b64(body), trailers, checksums });
  const text = td.decode(body);
  const auth = hdr('authorization');

  // STS
  if (/^sts\./.test(u.hostname)) {
    const action = new URLSearchParams(text).get('Action');
    const key = (/Credential=([A-Z0-9]+)\//.exec(auth) || [])[1] || '';
    if (action !== 'GetCallerIdentity') return xml(400, `<ErrorResponse><Error><Type>Sender</Type><Code>InvalidAction</Code><Message>${action}</Message></Error></ErrorResponse>`);
    if (key === 'AKIADENIEDEXAMPLE0000') {
      return xml(403, '<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>User is not authorized to perform: sts:GetCallerIdentity</Message></Error><RequestId>cert</RequestId></ErrorResponse>');
    }
    const who = key.startsWith('ASIA') ? 'assumed-role/ReadOnly/cert' : 'user/cert';
    return xml(200, `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:${key.startsWith('ASIA') ? 'sts' : 'iam'}::123456789012:${who}</Arn><UserId>${key}</UserId><Account>123456789012</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>cert</RequestId></ResponseMetadata></GetCallerIdentityResponse>`);
  }

  // SSO OIDC and the SSO portal
  if (/^oidc\./.test(u.hostname)) {
    const q = text ? JSON.parse(text) : {};
    if (u.pathname === '/client/register') {
      return json(200, { clientId: 'cert-client', clientSecret: 'cert-secret', clientIdIssuedAt: 1767225600, clientSecretExpiresAt: 4102444800 });
    }
    if (u.pathname === '/device_authorization') {
      if (q.clientId !== 'cert-client' || !q.startUrl) return json(400, { error: 'invalid_request' });
      return json(200, { deviceCode: 'cert-device-code', userCode: 'CERT-CODE', verificationUri: 'https://device.sso.us-east-1.amazonaws.com/', verificationUriComplete: 'https://device.sso.us-east-1.amazonaws.com/?user_code=CERT-CODE', expiresIn: 600, interval: 1 });
    }
    if (u.pathname === '/token') {
      if (q.deviceCode !== 'cert-device-code' || q.grantType !== 'urn:ietf:params:oauth:grant-type:device_code') return json(400, { error: 'invalid_grant' }, [['x-amzn-errortype', 'InvalidGrantException']]);
      g.awsCertTokens += 1;
      if (g.awsCertTokens === 1) return json(400, { error: 'authorization_pending', error_description: 'pending' }, [['x-amzn-errortype', 'AuthorizationPendingException']]);
      return json(200, { accessToken: 'cert-sso-access-token', tokenType: 'Bearer', expiresIn: 28800 });
    }
    return json(404, { error: 'not_found' });
  }
  if (/^portal\.sso\./.test(u.hostname)) {
    if (hdr('x-amz-sso_bearer_token') !== 'cert-sso-access-token') return json(401, { message: 'Session token not found or invalid' });
    if (u.pathname === '/federation/credentials') {
      return json(200, { roleCredentials: { accessKeyId: 'ASIACERTEXAMPLE00000', secretAccessKey: 'cert-sso-secret', sessionToken: 'cert-sso-session', expiration: 4102444800000 } });
    }
    return json(404, { message: 'not found' });
  }

  // S3, virtual-hosted style: <bucket>.s3.<region>.amazonaws.com
  if (/(^|\.)s3\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) {
    if (!/^AWS4-HMAC-SHA256 Credential=/.test(auth)) return s3err(403, 'AccessDenied', 'no SigV4 signature');
    const bucket = u.hostname.startsWith('s3.') ? '' : u.hostname.split('.s3.')[0];
    const key = decodeURIComponent(u.pathname.slice(1));
    const id = `${bucket}/${key}`;
    const q = u.searchParams;
    if (!bucket) {
      return xml(200, '<ListAllMyBucketsResult><Owner><ID>cert</ID></Owner><Buckets><Bucket><Name>cert-bucket</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>');
    }
    if (req.method === 'GET' && !key) {
      const keys = Object.keys(g.awsCertObjects).filter((k) => k.startsWith(`${bucket}/${q.get('prefix') || ''}`)).sort();
      const items = keys.map((k) => `<Contents><Key>${k.slice(bucket.length + 1)}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"etag"</ETag><Size>${unb64(g.awsCertObjects[k].bytes).length}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join('');
      return xml(200, `<ListBucketResult><Name>${bucket}</Name><Prefix>${q.get('prefix') || ''}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
    }
    if (req.method === 'POST' && q.has('uploads')) {
      const upload = `upload-${Object.keys(g.awsCertUploads).length + 1}`;
      g.awsCertUploads[upload] = { bucket, key, parts: {}, checksums: {}, algorithm: hdr('x-amz-checksum-algorithm'), type: hdr('x-amz-checksum-type') };
      return xml(200, `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${upload}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'PUT' && q.has('uploadId')) {
      const up = g.awsCertUploads[q.get('uploadId')];
      if (!up) return s3err(404, 'NoSuchUpload', 'no such upload');
      up.parts[q.get('partNumber')] = b64(body);
      up.checksums[q.get('partNumber')] = checksums;
      return { status: 200, headers: [['etag', `"part-${q.get('partNumber')}"`], ...Object.entries(checksums).map(([a, v]) => [`x-amz-checksum-${a}`, v])], body: '' };
    }
    if (req.method === 'POST' && q.has('uploadId')) {
      const up = g.awsCertUploads[q.get('uploadId')];
      if (!up) return s3err(404, 'NoSuchUpload', 'no such upload');
      const nums = Object.keys(up.parts).map(Number).sort((a, b) => a - b);
      const chunks = nums.map((n) => unb64(up.parts[n]));
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      g.awsCertObjects[id] = { bytes: b64(all), checksums, type: up.type || 'COMPOSITE' };
      return xml(200, `<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>"multipart-${nums.length}"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === 'PUT') {
      g.awsCertObjects[id] = { bytes: b64(body), checksums, type: 'FULL_OBJECT' };
      return { status: 200, headers: [['etag', '"etag"'], ...Object.entries(checksums).map(([a, v]) => [`x-amz-checksum-${a}`, v])], body: '' };
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const obj = g.awsCertObjects[id];
      if (!obj) return req.method === 'HEAD' ? { status: 404, headers: [], body: '' } : s3err(404, 'NoSuchKey', 'The specified key does not exist.');
      let bytes = unb64(obj.bytes);
      const total = bytes.length;
      const headers = [['etag', '"etag"'], ['last-modified', 'Thu, 01 Jan 2026 00:00:00 GMT'], ['content-type', 'application/octet-stream'], ['accept-ranges', 'bytes']];
      let status = 200;
      const range = /^bytes=(\d+)-(\d*)$/.exec(hdr('range'));
      if (range) {
        const a = Number(range[1]);
        const b = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        bytes = bytes.subarray(a, b + 1);
        headers.push(['content-range', `bytes ${a}-${b}/${total}`]);
        status = 206;
      }
      if (/enabled/i.test(hdr('x-amz-checksum-mode'))) {
        for (const [a, v] of Object.entries(obj.checksums)) {
          // A part's checksum on a ranged GET of a multipart object would be
          // the part's; this fake keeps it simple and answers whole-object
          // checksums on unranged reads and on HEAD only.
          if (range && req.method === 'GET') continue;
          let value = v;
          if (/tampered/.test(key)) value = btoa('\u0000'.repeat(atob(v).length));
          headers.push([`x-amz-checksum-${a}`, value]);
        }
        headers.push(['x-amz-checksum-type', obj.type]);
      }
      headers.push(['content-length', String(bytes.length)]);
      return { status, headers, body: req.method === 'HEAD' ? '' : bytes };
    }
    return s3err(405, 'MethodNotAllowed', `${req.method} ${u.pathname}${u.search}`);
  }
  return { status: 404, headers: [['content-type', 'text/plain']], body: te.encode(`aws-cli cert: no fake for ${req.method} ${req.url}\n`) };
}
