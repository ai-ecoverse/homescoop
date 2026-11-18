import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { awsResponder } from './lib/fake-aws.mjs';
import { clearLog, header, ok, requests, setState, sh } from './lib/aws.mjs';
import { verifySigV4 } from './lib/sigv4.mjs';

// aws login (AWS Sign-In, OAuth with PKCE and DPoP), against the fakes of
// AWS Sign-In and STS. Its EC P-256 key and ES256 DPoP proofs are
// awscrt.crypto.EC on cryptography (src/awscrt). login-remote.patch makes the
// cross-device flow (--remote) the default, since the same-device flow's
// callback server on 127.0.0.1 is out of a browser's reach in slicc
// (NEGATIVE.md): aws login prints the authorize URL and reads the code the
// browser shows (base64 of code=…&state=…), which a driver here answers
// from the URL's state, as a person pasting it would.
//  - The token request is the authorization code grant for the cross-device
//    client, its code verifier matches the URL's S256 challenge, and its
//    DPoP header is an ES256 JWT (dpop+jwt, htm POST, htu the token URL)
//    that verifies in Node with the P-256 key in its own header.
//  - The token cache keeps that key as a SEC1 "EC PRIVATE KEY" PEM, and the
//    profile gets login_session.
//  - With the access token about to expire, the next call refreshes it:
//    the key comes back from the cache (EC.new_key_from_der_data) and signs
//    the refresh's DPoP proof, the same jwk; STS is then signed with the new
//    credentials. The call after that uses them without a refresh.
const DRIVER = `
import base64, os, re, subprocess, sys, threading
p = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
# No prompt in 90 s (the same-device flow waits for its callback): stop it.
threading.Timer(90, p.kill).start()
out = b""
while b"Enter the authorization code" not in out:
    chunk = os.read(p.stdout.fileno(), 65536)
    if not chunk:
        break
    out += chunk
state = re.search(rb"[?&]state=([0-9a-f-]+)", out)
if state and b"Enter the authorization code" in out:
    code = base64.b64encode(b"code=cert-code&state=" + state.group(1))
    p.stdin.write(code + b"\\n")
    p.stdin.close()
rest = p.stdout.read()
sys.stdout.buffer.write(out + rest)
sys.stdout.flush()
os._exit(p.wait())
`;
const SIGNIN = 'https://us-east-1.signin.aws.amazon.com';
const SESSION = 'arn:aws:sts::123456789012:assumed-role/Admin/cert';
const b64u = (b) => Buffer.from(b).toString('base64url');

function dpop(assert, req) {
  const jwt = header(req, 'dpop');
  assert.ok(jwt, `no DPoP header on ${req.url}`);
  const [h, p, s] = jwt.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url'));
  const body = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(head.typ, 'dpop+jwt');
  assert.equal(head.alg, 'ES256');
  assert.deepEqual(Object.keys(head.jwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(body.htm, 'POST');
  assert.equal(body.htu, `${SIGNIN}/v1/token`);
  assert.ok(Math.abs(body.iat - Date.now() / 1000) < 600, `iat ${body.iat}`);
  assert.match(body.jti, /^[0-9a-f-]{36}$/);
  const key = createPublicKey({ key: { ...head.jwk }, format: 'jwk' });
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64, 'r || s, 32 bytes each');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, sig), 'the DPoP proof does not verify');
  return head.jwk;
}

export default async function (ctx) {
  const { assert, write, read } = ctx;
  await ctx.serve(awsResponder);
  await write('/tmp/login-driver.py', DRIVER);
  await setState(ctx, { login: { code: 'cert-code', expiresIn: 120 } });
  await ok(ctx, 'rm -rf ~/.aws/login ~/.aws/config; mkdir -p ~/.aws');
  await clearLog(ctx);

  const r = await sh(ctx, 'python3 /tmp/login-driver.py aws login --profile cert-login --region us-east-1 </dev/null');
  assert.equal(r.status, 0, `aws login: rc=${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Browser will not be automatically opened\./, r.stdout);
  assert.doesNotMatch(r.stdout, /127\.0\.0\.1|localhost|Traceback|Missing Dependency/, r.stdout);
  assert.match(r.stdout, new RegExp(`Updated profile cert-login to use ${SESSION.replace(/[/.]/g, '\\$&')} credentials\\.`), r.stdout);
  const authorize = new URL(/https:\/\/\S+\/v1\/authorize\?\S+/.exec(r.stdout)[0]);
  assert.equal(authorize.origin, SIGNIN);
  assert.equal(authorize.searchParams.get('client_id'), 'arn:aws:signin:::devtools/cross-device');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${SIGNIN}/v1/sessions/confirmation`);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'SHA-256');

  const [login] = await requests(ctx);
  assert.equal(`${login.method} ${login.url}`, `POST ${SIGNIN}/v1/token`);
  const input = JSON.parse(Buffer.from(login.decoded, 'base64'));
  assert.equal(input.grantType, 'authorization_code');
  assert.equal(input.clientId, 'arn:aws:signin:::devtools/cross-device');
  assert.equal(input.code, 'cert-code');
  const challenge = createHash('sha256').update(input.codeVerifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(authorize.searchParams.get('code_challenge').replace(/=+$/, ''), challenge, 'PKCE S256');
  const jwk = dpop(assert, login);

  const cacheFile = `/root/.aws/login/cache/${createHash('sha256').update(SESSION).digest('hex')}.json`;
  const cache = JSON.parse(await read(cacheFile));
  assert.match(cache.dpopKey, /^-----BEGIN EC PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END EC PRIVATE KEY-----\n$/);
  const cached = createPrivateKey(cache.dpopKey).export({ format: 'jwk' });
  assert.deepEqual({ x: cached.x, y: cached.y, crv: cached.crv }, { x: jwk.x, y: jwk.y, crv: 'P-256' }, 'the cached key is the DPoP key');
  assert.equal(cache.refreshToken, 'cert-refresh-1');
  assert.match(await read('/root/.aws/config'), new RegExp(`\\[profile cert-login\\]\\s*\\nlogin_session = ${SESSION.replace(/[/.]/g, '\\$&')}`));

  // The token expires in 120 s: the next call refreshes it, with the cached key.
  await clearLog(ctx);
  const who = await ok(ctx, 'aws sts get-caller-identity --profile cert-login --query Arn --output text </dev/null');
  assert.equal(who.stdout, 'arn:aws:sts::123456789012:assumed-role/ReadOnly/cert\n', who.stdout + who.stderr);
  const [refresh, sts] = await requests(ctx);
  assert.equal(`${refresh.method} ${refresh.url}`, `POST ${SIGNIN}/v1/token`);
  const again = JSON.parse(Buffer.from(refresh.decoded, 'base64'));
  assert.deepEqual([again.grantType, again.refreshToken], ['refresh_token', 'cert-refresh-1']);
  assert.deepEqual(dpop(assert, refresh), jwk, 'the refresh is proven with the same key');
  assert.ok(sts.url.startsWith('https://sts.'), sts.url);
  const v = verifySigV4(sts, 'login-secret-2');
  assert.ok(v.ok, v.why);
  assert.equal(v.key, 'ASIALOGINCERT0000002');
  assert.equal(header(sts, 'x-amz-security-token'), 'login-session-2');
  await clearLog(ctx);
  await ok(ctx, 'aws sts get-caller-identity --profile cert-login </dev/null');
  const third = (await requests(ctx)).map((q) => new URL(q.url).hostname);
  assert.equal(third.length, 1, `no second refresh: ${third}`);
  assert.match(third[0], /^sts\./, `no second refresh: ${third}`);
  console.log(`aws login: the cross-device flow by default, PKCE S256, an ES256 DPoP proof with a P-256 key that the token cache keeps (SEC1 PEM); the refresh reloads it for its own proof; STS signed with the refreshed credentials`);
}
