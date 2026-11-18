// X.509: build a CA and a leaf, sign, serialize, load back, check the
// signature, and the thumbprint az's certificate login (auth/identity.py
// through pyOpenSSL: SHA-1 of the DER) and msal compute; a CSR; PKCS12
// (az keyvault certificate import/download); a bad certificate is a
// ValueError.
const SCRIPT = String.raw`
import datetime, json
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
out = {}
now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
ca_key = ec.generate_private_key(ec.SECP256R1())
ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "homescoop test CA"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ai-ecoverse")])
ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
      .serial_number(1).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=3650))
      .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
      .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
      .sign(ca_key, hashes.SHA256()))
key = rsa.generate_private_key(65537, 2048)
csr = (x509.CertificateSigningRequestBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "sp.example.test")]))
       .add_extension(x509.SubjectAlternativeName([x509.DNSName("sp.example.test")]), critical=False).sign(key, hashes.SHA256()))
csr = x509.load_pem_x509_csr(csr.public_bytes(serialization.Encoding.PEM))
out["csr"] = [csr.is_signature_valid, csr.subject.rfc4514_string()]
leaf = (x509.CertificateBuilder().subject_name(csr.subject).issuer_name(ca.subject).public_key(csr.public_key())
        .serial_number(0x1234ABCD).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value, critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256()))
# az's certificate file: the private key and the certificate in one PEM
bundle = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()) + leaf.public_bytes(serialization.Encoding.PEM)
cert = x509.load_pem_x509_certificate(bundle[bundle.index(b"-----BEGIN CERTIFICATE-----"):])
pk = serialization.load_pem_private_key(bundle, password=None)
out["leaf"] = [cert.subject.rfc4514_string(), cert.issuer.rfc4514_string(), hex(cert.serial_number), cert.not_valid_after_utc.isoformat(),
               cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName),
               cert.signature_hash_algorithm.name]
cert.verify_directly_issued_by(ca)
out["issued_by"] = True
out["thumbprint"] = cert.fingerprint(hashes.SHA1()).hex().upper() == __import__("hashlib").sha1(cert.public_bytes(serialization.Encoding.DER)).hexdigest().upper()
out["key_matches"] = pk.public_key().public_numbers() == cert.public_key().public_numbers()
der = x509.load_der_x509_certificate(cert.public_bytes(serialization.Encoding.DER))
out["der_roundtrip"] = der == cert
p12 = pkcs12.serialize_key_and_certificates(b"sp", pk, cert, [ca], serialization.BestAvailableEncryption(b"pw"))
k2, c2, extra = pkcs12.load_key_and_certificates(p12, b"pw")
out["pkcs12"] = [c2 == cert, [c.subject.rfc4514_string() for c in extra], k2.key_size]
try:
    x509.load_pem_x509_certificate(b"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"); out["bad"] = "accepted"
except ValueError:
    out["bad"] = "ValueError"
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/crypto_x509.py', SCRIPT);
  const r = await run(['python3', '/tmp/crypto_x509.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.csr, [true, 'CN=sp.example.test'], o);
  assert.deepEqual(out.leaf, ['CN=sp.example.test', 'O=ai-ecoverse,CN=homescoop test CA', '0x1234abcd', '2027-01-01T00:00:00+00:00', ['sp.example.test'], 'sha256'], o);
  assert.equal(out.issued_by, true, o);
  assert.equal(out.thumbprint, true, o);
  assert.equal(out.key_matches, true, o);
  assert.equal(out.der_roundtrip, true, o);
  assert.deepEqual(out.pkcs12, [true, ['O=ai-ecoverse,CN=homescoop test CA'], 2048], o);
  assert.equal(out.bad, 'ValueError', o);
  console.log('x509: a CA (P-256) signs a CSR\'s leaf with SAN, EKU and AKI; the key+certificate PEM az logs in with loads, the leaf verifies against its CA, its SHA-1 thumbprint is the DER\'s, DER round-trips, PKCS12 with the CA chain round-trips, and a broken certificate raises ValueError');
}
