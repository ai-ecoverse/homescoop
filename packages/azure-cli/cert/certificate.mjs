import { createHash, verify, X509Certificate } from 'node:crypto';
import { entraAndArm, fresh, json, ok, served, SUBSCRIPTION, TENANT } from './lib/az.mjs';

const APP = 'cafe0000-0000-4000-8000-00000000a99a';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

// A self-signed certificate and its RSA key in one PEM, made in the kernel
// with py-cryptography (a plain python3 finds it by discovery).
const MAKE_CERT = `
import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "azure-cli cert service principal")])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=30)).sign(key, hashes.SHA256()))
with open("/root/sp-cert.pem", "wb") as f:
    f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    f.write(cert.public_bytes(serialization.Encoding.PEM))
`;

const b64u = (s) => Buffer.from(s, 'base64url');

// az login --service-principal --certificate <PEM>: azure-cli-core reads the
// certificate with pyOpenSSL (load_certificate, its SHA-1 digest) and MSAL
// signs the client assertion with cryptography. The assertion is checked
// here in Node, with Node's own crypto: a JWT with alg RS256 and an x5t that
// is the base64url SHA-1 thumbprint of the certificate's DER, aud the token
// endpoint, iss and sub the app id, a jti, a short lifetime, and an RS256
// signature that the certificate's public key verifies. Then az works with
// the token (az group list, az account get-access-token), and a PEM that
// isn't a certificate is az's own error, with no traceback.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  await ctx.write('/root/make-sp-cert.py', MAKE_CERT);
  await ok(ctx, 'python3 -I /root/make-sp-cert.py');
  const pem = await ctx.read('/root/sp-cert.pem');
  const cert = new X509Certificate(pem.slice(pem.indexOf('-----BEGIN CERTIFICATE-----')));

  const cfg = fresh('certificate');
  await ok(ctx, 'rm -rf /root/.azure-cert-certificate');
  const before = (await served(ctx)).length;
  const subs = await json(ctx, `${cfg} az login --service-principal -u ${APP} --certificate /root/sp-cert.pem --tenant ${TENANT}`);
  assert.deepEqual(subs.map((s) => [s.id, s.tenantId, s.user]), [[SUBSCRIPTION, TENANT, { name: APP, type: 'servicePrincipal' }]], JSON.stringify(subs));
  const grant = (await served(ctx)).slice(before).find((r) => r.url === TOKEN_URL);
  const form = new URLSearchParams(grant?.body || '');
  assert.equal(form.get('grant_type'), 'client_credentials', `token request: ${JSON.stringify(grant)}`);
  assert.equal(form.get('client_id'), APP);
  assert.equal(form.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
  assert.equal(form.get('client_secret'), null);

  const jwt = form.get('client_assertion');
  const [h, p, sig] = jwt.split('.');
  const head = JSON.parse(b64u(h));
  const claims = JSON.parse(b64u(p));
  assert.equal(head.alg, 'RS256', JSON.stringify(head));
  assert.equal(head.typ, 'JWT', JSON.stringify(head));
  const sha1 = createHash('sha1').update(cert.raw).digest();
  assert.equal(cert.fingerprint.replace(/:/g, '').toLowerCase(), sha1.toString('hex'));
  // MSAL writes it with Python's urlsafe_b64encode, padding kept.
  assert.equal(head.x5t, sha1.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), `x5t ${head.x5t}, the certificate's SHA-1 is ${cert.fingerprint}`);
  assert.ok(!('x5t#S256' in head), 'azure-cli passes the SHA-1 thumbprint, so MSAL signs RS256 with x5t');
  assert.equal(claims.aud, TOKEN_URL, JSON.stringify(claims));
  assert.equal(claims.iss, APP);
  assert.equal(claims.sub, APP);
  assert.match(claims.jti, /^[0-9a-f-]{16,}$/i, JSON.stringify(claims));
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now - 60 && claims.exp - (claims.nbf ?? claims.iat) <= 3600, JSON.stringify(claims));
  assert.ok(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), cert.publicKey, b64u(sig)), 'the assertion\'s signature does not verify with the certificate\'s key');
  assert.ok(!verify('RSA-SHA256', Buffer.from(`${h}.${p}x`), cert.publicKey, b64u(sig)), 'a changed assertion still verifies');

  const groups = await json(ctx, `${cfg} az group list --query "[].name"`);
  assert.deepEqual(groups, ['cert-rg']);
  const arm = (await served(ctx)).filter((r) => /\/resourcegroups\?/i.test(r.url)).pop();
  assert.match(arm.auth, /^Bearer cert-at-client_credentials-.*-certificate$/, arm.auth);
  assert.match((await json(ctx, `${cfg} az account get-access-token`)).accessToken, /-certificate$/);
  // service_principal_entries.json keeps the certificate's path, not the key.
  const entries = await json(ctx, 'cat /root/.azure-cert-certificate/service_principal_entries.json');
  assert.deepEqual(entries.map((e) => [e.client_id, e.tenant, e.certificate]), [[APP, TENANT, '/root/sp-cert.pem']], JSON.stringify(entries));

  // Not a certificate: pyOpenSSL's error, as az words it.
  await ctx.write('/root/not-a-cert.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const bad = await ctx.run(['bash', '-c', `${fresh('certificate-bad')} az login --service-principal -u ${APP} --certificate /root/not-a-cert.pem --tenant ${TENANT}`], { cwd: '/root' });
  assert.equal(bad.status, 1, `${bad.stdout}\n${bad.stderr}`);
  assert.match(bad.stderr, /^ERROR: Invalid certificate, please use a valid PEM file\. Error detail: /m, bad.stderr);
  assert.doesNotMatch(bad.stderr, /Traceback|This command needs/, bad.stderr);
  console.log(`az login --service-principal --certificate: a client assertion with alg RS256, x5t = the certificate's SHA-1 (${head.x5t}), aud the token endpoint, iss = sub = the app, verified with the certificate's key in Node; az group list and get-access-token with the token; a PEM without a certificate is az's "Invalid certificate" error`);
}
