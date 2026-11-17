// RSA, EC and Ed25519: keygen, sign, verify (and a wrong signature), and the
// serializations az uses: azure/cli/core/keys.py's generate_ssh_keys (RSA
// 2048, PEM TraditionalOpenSSL private key at 0600, OpenSSH public key)
// and its reload of an existing private key; msal's JWT assertion signature
// (RS256: PKCS1v15 SHA-256) from a PEM key.
const SCRIPT = String.raw`
import base64, json, os, struct
from cryptography import exceptions
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa, x25519
out = {}
home = os.path.expanduser("~/.ssh")
os.makedirs(home, exist_ok=True)
# azure.cli.core.keys.generate_ssh_keys, as az vm create --generate-ssh-keys runs it
priv_path, pub_path = os.path.join(home, "id_rsa"), os.path.join(home, "id_rsa.pub")
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
pem = key.private_bytes(encoding=serialization.Encoding.PEM, format=serialization.PrivateFormat.TraditionalOpenSSL, encryption_algorithm=serialization.NoEncryption())
with os.fdopen(os.open(priv_path, os.O_WRONLY | os.O_TRUNC | os.O_CREAT, 0o600), "wb") as f:
    f.write(pem)
pub = key.public_key().public_bytes(encoding=serialization.Encoding.OpenSSH, format=serialization.PublicFormat.OpenSSH)
with os.fdopen(os.open(pub_path, os.O_WRONLY | os.O_TRUNC | os.O_CREAT, 0o644), "wb") as f:
    f.write(pub)
parts = pub.split()
data = base64.b64decode(parts[1])
n = struct.unpack(">I", data[:4])[0]
out["ssh"] = [pem.splitlines()[0].decode(), parts[0].decode(), data[4:4 + n].decode(), oct(os.stat(priv_path).st_mode & 0o777), key.key_size]
with open(priv_path, "rb") as f:
    again = serialization.load_pem_private_key(f.read(), password=None)
out["reload"] = again.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH) == pub
# RS256 (msal's client assertion through PyJWT) and PSS
msg = b"header.payload"
sig = again.sign(msg, padding.PKCS1v15(), hashes.SHA256())
key.public_key().verify(sig, msg, padding.PKCS1v15(), hashes.SHA256())
pss = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH)
key.public_key().verify(key.sign(msg, pss, hashes.SHA256()), msg, pss, hashes.SHA256())
def bad(pub, *a):
    try:
        pub.verify(*a); return "accepted"
    except exceptions.InvalidSignature:
        return "InvalidSignature"
out["rsa_bad"] = bad(key.public_key(), sig, b"other", padding.PKCS1v15(), hashes.SHA256())
oaep = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
out["oaep"] = key.decrypt(key.public_key().encrypt(b"wrapped", oaep), oaep).decode()
enc = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(b"pw"))
try:
    serialization.load_pem_private_key(enc, password=b"wrong"); out["wrong_pw"] = "accepted"
except ValueError:
    out["wrong_pw"] = "ValueError"
out["right_pw"] = serialization.load_pem_private_key(enc, password=b"pw").key_size
# EC P-256 / P-384, ECDH
eck = ec.generate_private_key(ec.SECP256R1())
esig = eck.sign(msg, ec.ECDSA(hashes.SHA256()))
eck.public_key().verify(esig, msg, ec.ECDSA(hashes.SHA256()))
out["ec_bad"] = bad(eck.public_key(), esig, b"other", ec.ECDSA(hashes.SHA256()))
a, b = ec.generate_private_key(ec.SECP384R1()), ec.generate_private_key(ec.SECP384R1())
out["ecdh"] = a.exchange(ec.ECDH(), b.public_key()) == b.exchange(ec.ECDH(), a.public_key())
out["ec_ssh"] = eck.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).split()[0].decode()
# Ed25519 with an OpenSSH private key, X25519
ed = ed25519.Ed25519PrivateKey.generate()
edsig = ed.sign(msg)
ed.public_key().verify(edsig, msg)
out["ed_bad"] = bad(ed.public_key(), edsig, b"other")
ossh = ed.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption())
back = serialization.load_ssh_private_key(ossh, password=None)
out["ed_ssh"] = [ossh.splitlines()[0].decode(), back.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw) == ed.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw), ed.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).split()[0].decode()]
x1, x2 = x25519.X25519PrivateKey.generate(), x25519.X25519PrivateKey.generate()
out["x25519"] = x1.exchange(x2.public_key()) == x2.exchange(x1.public_key())
loaded = serialization.load_ssh_public_key(pub)
out["ssh_pub_load"] = loaded.public_numbers() == key.public_key().public_numbers()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/crypto_keys.py', SCRIPT);
  const r = await run(['python3', '/tmp/crypto_keys.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.ssh, ['-----BEGIN RSA PRIVATE KEY-----', 'ssh-rsa', 'ssh-rsa', '0o600', 2048], o);
  assert.equal(out.reload, true, o);
  assert.equal(out.rsa_bad, 'InvalidSignature', o);
  assert.equal(out.oaep, 'wrapped', o);
  assert.equal(out.wrong_pw, 'ValueError', o);
  assert.equal(out.right_pw, 2048, o);
  assert.equal(out.ec_bad, 'InvalidSignature', o);
  assert.equal(out.ecdh, true, o);
  assert.equal(out.ec_ssh, 'ecdsa-sha2-nistp256', o);
  assert.equal(out.ed_bad, 'InvalidSignature', o);
  assert.deepEqual(out.ed_ssh, ['-----BEGIN OPENSSH PRIVATE KEY-----', true, 'ssh-ed25519'], o);
  assert.equal(out.x25519, true, o);
  assert.equal(out.ssh_pub_load, true, o);
  console.log('keys: az generate_ssh_keys (RSA 2048, TraditionalOpenSSL PEM at 0600, ssh-rsa public key) and its reload; RS256, PSS and OAEP; an encrypted PKCS8 key refuses the wrong password; P-256 ECDSA, P-384 ECDH, Ed25519 with an OpenSSH private key, X25519; every wrong signature raises InvalidSignature');
}
