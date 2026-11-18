// src/awscrt (awscrt.crypto on cryptography), from the built package, run by
// the build machine's python3 with its own cryptography, against Node: the
// awscrt behaviour the AWS CLI depends on. Skipped when that python has no
// cryptography; the cert runs the same code in slicc on py-cryptography.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, publicEncrypt, constants, sign, verify } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, '..', 'package', 'lib', 'aws-cli');
const hasCryptography = spawnSync('python3', ['-c', 'import cryptography'], { encoding: 'utf8' }).status === 0;

function py(code, input) {
  const out = execFileSync('python3', ['-B', '-c', `import json, sys\nsys.path.insert(0, ${JSON.stringify(lib)})\nimport awscli\n${code}`], { input: JSON.stringify(input), encoding: 'utf8' });
  return JSON.parse(out);
}

test('awscrt.crypto on cryptography', { skip: !hasCryptography && 'no cryptography in the build machine\'s python3' }, () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1 = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' });
  const pkcs8 = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const der = rsa.publicKey.export({ type: 'pkcs1', format: 'der' }).toString('base64');
  const ciphertext = publicEncrypt({ key: rsa.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from('Pa$$w0rd')).toString('base64');
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sec1 = ec.privateKey.export({ type: 'sec1', format: 'der' }).toString('base64');
  const r = py(`
import base64, hashlib
from awscrt import crypto as c, _HOMESCOOP_CRYPTO_ONLY
from botocore.compat import HAS_CRT
i = json.load(sys.stdin)
out = {'has_crt': HAS_CRT, 'shim': _HOMESCOOP_CRYPTO_ONLY}
msg = b'the message'
for name in ('pkcs1', 'pkcs8'):
    k = c.RSA.new_private_key_from_pem_data(i[name])
    out[name + '_sha1'] = k.sign(c.RSASignatureAlgorithm.PKCS1_5_SHA1, hashlib.sha1(msg).digest()).hex()
    out[name + '_sha256'] = k.sign(c.RSASignatureAlgorithm.PKCS1_5_SHA256, hashlib.sha256(msg).digest()).hex()
    # get-password-data passes RSASignatureAlgorithm.PKCS1_5_SHA256 (0), that is PKCS1_5.
    out[name + '_decrypt'] = k.decrypt(c.RSASignatureAlgorithm.PKCS1_5_SHA256, base64.b64decode(i['ciphertext'])).decode()
pub = c.RSA.new_public_key_from_der_data(base64.b64decode(i['der']))
sig = bytes.fromhex(out['pkcs1_sha256'])
out['verify'] = [pub.verify(c.RSASignatureAlgorithm.PKCS1_5_SHA256, hashlib.sha256(msg).digest(), sig),
                 pub.verify(c.RSASignatureAlgorithm.PKCS1_5_SHA256, hashlib.sha256(b'other').digest(), sig)]
errors = []
for f in (lambda: c.RSA.new_public_key_from_der_data(b'not a key'), lambda: c.EC.new_key_from_der_data(b'not a key')):
    try:
        f()
    except Exception as e:
        errors.append([isinstance(e, RuntimeError), isinstance(e, ValueError)])
out['errors'] = errors
try:
    c.RSA.new_private_key_from_pem_data('no pem here')
except ValueError as e:
    out['no_pem'] = str(e)
k = c.EC.new_key_from_der_data(base64.b64decode(i['sec1']))
x, y = k.get_public_coords()
out['coords'] = [x.hex(), y.hex()]
d = hashlib.sha256(msg).digest()
out['ec_sig'] = k.sign(d).hex()
out['jose'] = c.EC.decode_der_signature_to_padded_pair(bytes.fromhex(out['ec_sig']), pad_to=32).hex()
out['sec1_roundtrip'] = c.EC.new_key_from_der_data(k.export_key(c.ECExportFormat.SEC1)).get_public_coords() == (x, y)
g = c.EC.new_generate(c.ECType.P_256)
out['generated'] = len(g.get_public_coords().x)
e = c.ED25519.new_generate()
out['ed_pub'] = e.export_public_key(c.ED25519ExportFormat.OPENSSH_B64).decode()
out['ed_priv'] = e.export_private_key(c.ED25519ExportFormat.OPENSSH_B64).decode()
out['ed_raw'] = [len(e.export_public_key(c.ED25519ExportFormat.RAW)), len(e.export_private_key(c.ED25519ExportFormat.RAW))]
from awscrt.crypto import SomethingNewer
try:
    SomethingNewer()
except Exception as e:
    out['missing'] = str(e)
print(json.dumps(out))
`, { pkcs1, pkcs8, der, ciphertext, sec1 });
  assert.equal(r.has_crt, false);
  assert.equal(r.shim, true);
  for (const name of ['pkcs1', 'pkcs8']) {
    // RSA PKCS#1 v1.5 is deterministic: Node's signatures, byte for byte.
    assert.equal(r[`${name}_sha1`], sign('sha1', Buffer.from('the message'), rsa.privateKey).toString('hex'), `${name} SHA-1`);
    assert.equal(r[`${name}_sha256`], sign('sha256', Buffer.from('the message'), rsa.privateKey).toString('hex'), `${name} SHA-256`);
    assert.equal(r[`${name}_decrypt`], 'Pa$$w0rd');
  }
  assert.deepEqual(r.verify, [true, false]);
  assert.deepEqual(r.errors, [[true, true], [true, true]], 'a key that does not load is a RuntimeError and a ValueError');
  assert.equal(r.no_pem, 'RSA private key not found in PEM.');
  const jwk = createPrivateKey({ key: Buffer.from(sec1, 'base64'), format: 'der', type: 'sec1' }).export({ format: 'jwk' });
  assert.deepEqual(r.coords, [Buffer.from(jwk.x, 'base64url').toString('hex'), Buffer.from(jwk.y, 'base64url').toString('hex')]);
  assert.ok(verify('sha256', Buffer.from('the message'), ec.publicKey, Buffer.from(r.ec_sig, 'hex')), 'ECDSA, DER');
  assert.ok(verify('sha256', Buffer.from('the message'), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(r.jose, 'hex')), 'r || s');
  assert.equal(r.jose.length, 128);
  assert.equal(r.sec1_roundtrip, true);
  assert.equal(r.generated, 32);
  // Ed25519 for OpenSSH: the public key's base64 blob, the private key as one base64 line.
  const blob = Buffer.from(r.ed_pub, 'base64');
  assert.equal(blob.readUInt32BE(0), 11);
  assert.equal(blob.subarray(4, 15).toString(), 'ssh-ed25519');
  assert.doesNotMatch(r.ed_priv, /\n/);
  assert.equal(Buffer.from(r.ed_priv, 'base64').subarray(0, 15).toString('latin1'), 'openssh-key-v1\0');
  assert.ok(Buffer.from(r.ed_priv, 'base64').includes(blob), 'the private key holds the public key');
  assert.deepEqual(r.ed_raw, [32, 32]);
  assert.match(r.missing, /^Missing Dependency: awscrt\.crypto\.SomethingNewer requires awscrt/);
});
