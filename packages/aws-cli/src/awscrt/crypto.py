"""homescoop (slicc): awscrt.crypto's API (awscrt 0.38.1) on pyca/cryptography.

The classes, enums and methods are awscrt's, with awscrt's behaviour where the
AWS CLI depends on it (see awscrt/__init__.py for who calls what):

  - Failures raise RuntimeError, as awscrt's native code does; a PEM without
    the key asked for raises ValueError, as awscrt does. A key that doesn't
    load raises an error that is both (KeyLoadError): awscrt documents
    ValueError and raises RuntimeError, and the CLI catches one or the
    other (cloudtrail validate-logs RuntimeError, verify-query-results and
    the `aws login` credentials ValueError).
  - RSA.decrypt() takes the algorithm as a number, as awscrt's C code does:
    the CLI passes RSASignatureAlgorithm.PKCS1_5_SHA256 (0) to decrypt, which
    is RSAEncryptionAlgorithm.PKCS1_5 (0).
  - sign() takes the digest of the message, not the message (Prehashed).
  - RSA private keys come from PKCS#1 ("RSA PRIVATE KEY") or PKCS#8
    ("PRIVATE KEY") PEM; EC keys from SEC1, PKCS#8 or SPKI DER, P-256 and
    P-384 only; Ed25519 keys export as RAW or as OpenSSH base64 (one line,
    as awscrt writes it).

cryptography is imported on first use, not when the CLI starts (it loads a
large native module). Without it, each call raises botocore's
MissingDependencyException.
"""
import base64
import re
from enum import IntEnum
from types import SimpleNamespace
from typing import NamedTuple

_PEM = re.compile(rb"-----BEGIN ([A-Z0-9 ]+)-----\r?\n(.*?)-----END \1-----", re.S)


_loaded = None


def _c():
    """The cryptography modules, imported on first use."""
    global _loaded
    if _loaded is None:
        try:
            from cryptography import exceptions
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa, utils
        except ImportError as e:
            from botocore.exceptions import MissingDependencyException

            raise MissingDependencyException(
                msg=(
                    'This command needs cryptography (@ai-ecoverse/py-cryptography, '
                    'which this AWS CLI build installs beside it), and it could not '
                    f'be imported: {e}'
                )
            ) from None
        _loaded = SimpleNamespace(
            exceptions=exceptions, hashes=hashes, serialization=serialization,
            ec=ec, ed25519=ed25519, padding=padding, rsa=rsa, utils=utils,
        )
    return _loaded


def _fail(what, e, cls=RuntimeError):
    return cls(f'{what}: {e}' if str(e) else what)


class KeyLoadError(RuntimeError, ValueError):
    """A key that doesn't load (see the top of the file)."""


def _bytes(data):
    return data.encode() if isinstance(data, str) else bytes(data)


def _pem_der(pem_data, label):
    """The DER of the first PEM block with this label, or None."""
    for m in _PEM.finditer(_bytes(pem_data)):
        if m.group(1).decode() == label:
            try:
                return base64.b64decode(b''.join(m.group(2).split()), validate=True)
            except ValueError as e:
                raise _fail(f'invalid {label} PEM', e, KeyLoadError)
    return None


class RSAEncryptionAlgorithm(IntEnum):
    PKCS1_5 = 0
    OAEP_SHA256 = 1
    OAEP_SHA512 = 2


class RSASignatureAlgorithm(IntEnum):
    PKCS1_5_SHA256 = 0
    PKCS1_5_SHA1 = 1
    PSS_SHA256 = 2


def _rsa_encryption_padding(c, algorithm):
    algorithm = RSAEncryptionAlgorithm(int(algorithm))
    if algorithm is RSAEncryptionAlgorithm.PKCS1_5:
        return c.padding.PKCS1v15()
    h = c.hashes.SHA256() if algorithm is RSAEncryptionAlgorithm.OAEP_SHA256 else c.hashes.SHA512()
    return c.padding.OAEP(mgf=c.padding.MGF1(h), algorithm=h, label=None)


def _rsa_signature(c, algorithm):
    """(padding, prehashed algorithm) for an RSASignatureAlgorithm."""
    algorithm = RSASignatureAlgorithm(int(algorithm))
    if algorithm is RSASignatureAlgorithm.PKCS1_5_SHA1:
        return c.padding.PKCS1v15(), c.utils.Prehashed(c.hashes.SHA1())
    if algorithm is RSASignatureAlgorithm.PKCS1_5_SHA256:
        return c.padding.PKCS1v15(), c.utils.Prehashed(c.hashes.SHA256())
    # aws-c-cal: PSS with MGF1-SHA256 and a salt as long as the digest.
    pss = c.padding.PSS(mgf=c.padding.MGF1(c.hashes.SHA256()), salt_length=c.padding.PSS.DIGEST_LENGTH)
    return pss, c.utils.Prehashed(c.hashes.SHA256())


class RSA:
    """An RSA private key (sign, decrypt, and the public operations) or public key."""

    def __init__(self, binding):
        self._binding = binding

    @staticmethod
    def _private(der):
        c = _c()
        try:
            key = c.serialization.load_der_private_key(der, password=None)
        except (ValueError, TypeError, c.exceptions.UnsupportedAlgorithm) as e:
            raise _fail('cannot load the RSA private key', e, KeyLoadError)
        if not isinstance(key, c.rsa.RSAPrivateKey):
            raise KeyLoadError('the private key is not an RSA key')
        return RSA(key)

    @staticmethod
    def _public(der):
        c = _c()
        try:
            key = c.serialization.load_der_public_key(der)
        except (ValueError, TypeError, c.exceptions.UnsupportedAlgorithm) as e:
            raise _fail('cannot load the RSA public key', e, KeyLoadError)
        if not isinstance(key, c.rsa.RSAPublicKey):
            raise KeyLoadError('the public key is not an RSA key')
        return RSA(key)

    @staticmethod
    def new_private_key_from_pem_data(pem_data):
        der = _pem_der(pem_data, 'RSA PRIVATE KEY')
        if der is None:
            der = _pem_der(pem_data, 'PRIVATE KEY')
        if der is None:
            raise ValueError('RSA private key not found in PEM.')
        return RSA._private(der)

    @staticmethod
    def new_public_key_from_pem_data(pem_data):
        der = _pem_der(pem_data, 'RSA PUBLIC KEY')
        if der is None:
            raise ValueError('RSA public key not found in PEM.')
        return RSA._public(der)

    @staticmethod
    def new_private_key_from_der_data(der_data):
        return RSA._private(bytes(der_data))

    @staticmethod
    def new_public_key_from_der_data(der_data):
        # PKCS#1 RSAPublicKey, as awscrt expects (CloudTrail's public keys);
        # cryptography also reads a SubjectPublicKeyInfo.
        return RSA._public(bytes(der_data))

    def _public_key(self):
        k = self._binding
        return k.public_key() if hasattr(k, 'public_key') else k

    def encrypt(self, encryption_algorithm, plaintext):
        c = _c()
        try:
            return self._public_key().encrypt(bytes(plaintext), _rsa_encryption_padding(c, encryption_algorithm))
        except ValueError as e:
            raise _fail('RSA encryption failed', e)

    def decrypt(self, encryption_algorithm, ciphertext):
        c = _c()
        if not hasattr(self._binding, 'decrypt'):
            raise RuntimeError('RSA decryption needs a private key')
        try:
            return self._binding.decrypt(bytes(ciphertext), _rsa_encryption_padding(c, encryption_algorithm))
        except ValueError as e:
            raise _fail('RSA decryption failed', e)

    def sign(self, signature_algorithm, digest):
        c = _c()
        if not hasattr(self._binding, 'sign'):
            raise RuntimeError('RSA signing needs a private key')
        pad, algorithm = _rsa_signature(c, signature_algorithm)
        try:
            return self._binding.sign(bytes(digest), pad, algorithm)
        except ValueError as e:
            raise _fail('RSA signing failed', e)

    def verify(self, signature_algorithm, digest, signature):
        c = _c()
        pad, algorithm = _rsa_signature(c, signature_algorithm)
        try:
            self._public_key().verify(bytes(signature), bytes(digest), pad, algorithm)
        except c.exceptions.InvalidSignature:
            return False
        except ValueError as e:
            raise _fail('RSA verification failed', e)
        return True


class ED25519ExportFormat(IntEnum):
    RAW = 0
    OPENSSH_B64 = 1


class ED25519:
    """An Ed25519 key pair, generated here, exported raw or for OpenSSH."""

    def __init__(self, binding):
        self._binding = binding

    @staticmethod
    def new_generate():
        return ED25519(_c().ed25519.Ed25519PrivateKey.generate())

    def export_public_key(self, export_format):
        s = _c().serialization
        pub = self._binding.public_key()
        if ED25519ExportFormat(int(export_format)) is ED25519ExportFormat.RAW:
            return pub.public_bytes(s.Encoding.Raw, s.PublicFormat.Raw)
        # "ssh-ed25519 <base64>": the base64 of the key blob (RFC 8709).
        return pub.public_bytes(s.Encoding.OpenSSH, s.PublicFormat.OpenSSH).split()[1]

    def export_private_key(self, export_format):
        s = _c().serialization
        if ED25519ExportFormat(int(export_format)) is ED25519ExportFormat.RAW:
            return self._binding.private_bytes(s.Encoding.Raw, s.PrivateFormat.Raw, s.NoEncryption())
        # The openssh-key-v1 blob, unencrypted, no comment, as one base64
        # line (awscrt's); the CLI adds the BEGIN/END OPENSSH PRIVATE KEY lines.
        pem = self._binding.private_bytes(s.Encoding.PEM, s.PrivateFormat.OpenSSH, s.NoEncryption())
        return b''.join(pem.splitlines()[1:-1])


class ECType(IntEnum):
    P_256 = 0
    P_384 = 1


class ECExportFormat(IntEnum):
    SEC1 = 0
    PKCS8 = 1
    SPKI = 2


class ECRawSignature(NamedTuple):
    r: bytes
    s: bytes


class ECPublicCoords(NamedTuple):
    x: bytes
    y: bytes


_CURVES = {ECType.P_256: 'SECP256R1', ECType.P_384: 'SECP384R1'}


def _int_bytes(n, size=None):
    return n.to_bytes(size or max(1, (n.bit_length() + 7) // 8), 'big')


class EC:
    """An EC key pair (P-256, P-384) or public key: ECDSA with DER signatures."""

    def __init__(self, binding):
        self._binding = binding

    @staticmethod
    def new_generate(type):
        c = _c()
        return EC(c.ec.generate_private_key(getattr(c.ec, _CURVES[ECType(int(type))])()))

    @staticmethod
    def new_key_from_der_data(der_data):
        c = _c()
        der = bytes(der_data)
        try:
            key = c.serialization.load_der_private_key(der, password=None)
        except (ValueError, TypeError, c.exceptions.UnsupportedAlgorithm):
            try:
                key = c.serialization.load_der_public_key(der)
            except (ValueError, TypeError, c.exceptions.UnsupportedAlgorithm) as e:
                raise _fail('cannot load the EC key', e, KeyLoadError)
        if not isinstance(key, (c.ec.EllipticCurvePrivateKey, c.ec.EllipticCurvePublicKey)):
            raise KeyLoadError('the key is not an EC key')
        if key.curve.name not in ('secp256r1', 'secp384r1'):
            raise KeyLoadError(f'unsupported curve {key.curve.name} (P-256 and P-384 only)')
        return EC(key)

    @staticmethod
    def decode_der_signature(signature):
        r, s = _c().utils.decode_dss_signature(bytes(signature))
        return ECRawSignature(r=_int_bytes(r), s=_int_bytes(s))

    @staticmethod
    def decode_der_signature_to_padded_pair(signature, pad_to):
        try:
            r, s = _c().utils.decode_dss_signature(bytes(signature))
            return _int_bytes(r, pad_to) + _int_bytes(s, pad_to)
        except (ValueError, OverflowError) as e:
            raise _fail('cannot decode the EC signature', e)

    @staticmethod
    def encode_raw_signature(signature):
        return _c().utils.encode_dss_signature(
            int.from_bytes(signature.r, 'big'), int.from_bytes(signature.s, 'big')
        )

    def _public_key(self):
        k = self._binding
        return k.public_key() if hasattr(k, 'public_key') else k

    def export_key(self, export_format):
        s = _c().serialization
        export_format = ECExportFormat(int(export_format))
        if export_format is ECExportFormat.SPKI:
            return self._public_key().public_bytes(s.Encoding.DER, s.PublicFormat.SubjectPublicKeyInfo)
        if not hasattr(self._binding, 'private_bytes'):
            raise RuntimeError('exporting a private key needs a private key')
        fmt = s.PrivateFormat.TraditionalOpenSSL if export_format is ECExportFormat.SEC1 else s.PrivateFormat.PKCS8
        return self._binding.private_bytes(s.Encoding.DER, fmt, s.NoEncryption())

    def get_public_coords(self):
        pub = self._public_key()
        size = (pub.curve.key_size + 7) // 8
        n = pub.public_numbers()
        return ECPublicCoords(x=_int_bytes(n.x, size), y=_int_bytes(n.y, size))

    def _prehashed(self, c, digest):
        algorithms = {20: c.hashes.SHA1, 32: c.hashes.SHA256, 48: c.hashes.SHA384, 64: c.hashes.SHA512}
        if len(digest) not in algorithms:
            raise RuntimeError(f'unsupported digest length {len(digest)}')
        return c.ec.ECDSA(c.utils.Prehashed(algorithms[len(digest)]()))

    def sign(self, digest):
        c = _c()
        if not hasattr(self._binding, 'sign'):
            raise RuntimeError('EC signing needs a private key')
        digest = bytes(digest)
        return self._binding.sign(digest, self._prehashed(c, digest))

    def verify(self, digest, signature):
        c = _c()
        digest = bytes(digest)
        try:
            self._public_key().verify(bytes(signature), digest, self._prehashed(c, digest))
        except c.exceptions.InvalidSignature:
            return False
        return True


class _Missing:
    """A name awscrt.crypto has and this module doesn't: fails when used."""

    def __init__(self, name):
        self._name = name

    def _fail(self, *args, **kwargs):
        from botocore.compat import crt_unavailable

        raise crt_unavailable(f'awscrt.crypto.{self._name}')

    __call__ = _fail

    def __getattr__(self, attr):
        self._fail()


def __getattr__(name):
    # A newer AWS CLI that imports another awscrt.crypto name still starts;
    # the command that uses it says it needs awscrt.
    if name.startswith('__'):
        raise AttributeError(name)
    return _Missing(name)
