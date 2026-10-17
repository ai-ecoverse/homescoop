/**
 * Just enough X.509 for the engine's host cert: a P-256 CA that signs itself,
 * and leaves it signs for a given SubjectPublicKeyInfo, shaped as SLICC's
 * realm CA issues them (slicc-kernel src/kernel/net/x509.ts): v3, ECDSA with
 * SHA-256, SKI/AKI, basicConstraints, keyUsage, serverAuth and a DNS or IP
 * subjectAltName. Signing is node:crypto's (DER ECDSA signatures).
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const concat = (parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));

function length(n) {
  if (n < 0x80) return Buffer.of(n);
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.of(0x80 | bytes.length, ...bytes);
}

const tlv = (tag, ...contents) => {
  const body = concat(contents);
  return concat([Buffer.of(tag), length(body.length), body]);
};
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const octets = (bytes) => tlv(0x04, bytes);
const bits = (bytes, unused = 0) => tlv(0x03, Buffer.of(unused), bytes);
const TRUE = tlv(0x01, Buffer.of(0xff));

function integer(magnitude) {
  let start = 0;
  while (start < magnitude.length - 1 && magnitude[start] === 0) start++;
  const trimmed = Buffer.from(magnitude).subarray(start);
  return tlv(0x02, trimmed[0] & 0x80 ? concat([Buffer.of(0), trimmed]) : trimmed);
}

function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const arc of rest) {
    const groups = [];
    for (let v = arc; ; v = Math.floor(v / 128)) {
      groups.unshift(v & 0x7f);
      if (v < 128) break;
    }
    out.push(...groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g)));
  }
  return tlv(0x06, Buffer.from(out));
}

const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));

function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

function name(dn) {
  const rdns = [];
  if (dn.organization) rdns.push(set(seq(oid('2.5.4.10'), utf8(dn.organization))));
  rdns.push(set(seq(oid('2.5.4.3'), utf8(dn.commonName))));
  return seq(...rdns);
}

const extension = (id, critical, value) =>
  critical ? seq(oid(id), TRUE, octets(value)) : seq(oid(id), octets(value));

/** The BIT STRING of a SubjectPublicKeyInfo (P-256: 0x04 || X || Y). */
function publicKeyBits(spki) {
  // SEQUENCE { SEQUENCE algorithm, BIT STRING key }: the key is the tail.
  const der = Buffer.from(spki);
  const algLen = der[3] + 2; // the algorithm SEQUENCE is short-form
  const key = der.subarray(2 + algLen);
  const lenByte = key[1];
  const start = lenByte & 0x80 ? 2 + (lenByte & 0x7f) : 2;
  return key.subarray(start + 1);
}

const keyId = (spki) => createHash('sha1').update(publicKeyBits(spki)).digest();

function ipBytes(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m ? Buffer.from(m.slice(1).map(Number)) : undefined;
}

function certificate({ issuer, subject, notBefore, notAfter, spki, issuerSpki, ca, pathLen = 0, host, key, san, eku = '1.3.6.1.5.5.7.3.1' }) {
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const list = [extension('2.5.29.14', false, octets(keyId(spki)))];
  if (ca) {
    list.push(extension('2.5.29.19', true, seq(TRUE, integer(Buffer.of(pathLen)))));
    list.push(extension('2.5.29.15', true, bits(Buffer.of(0x86), 1)));
  } else {
    list.push(extension('2.5.29.35', false, seq(tlv(0x80, keyId(issuerSpki)))));
    list.push(extension('2.5.29.19', true, seq()));
    list.push(extension('2.5.29.15', true, bits(Buffer.of(0x80), 7)));
    list.push(extension('2.5.29.37', false, seq(oid(eku))));
    const ip = san === 'dns' ? undefined : ipBytes(host);
    list.push(extension('2.5.29.17', false, seq(ip ? tlv(0x87, ip) : tlv(0x82, Buffer.from(host)))));
  }
  const tbs = seq(
    tlv(0xa0, integer(Buffer.of(2))),
    integer(serial),
    ECDSA_SHA256,
    name(issuer),
    seq(time(notBefore), time(notAfter)),
    name(subject),
    Buffer.from(spki),
    tlv(0xa3, seq(...list)),
  );
  return seq(tbs, ECDSA_SHA256, bits(sign('sha256', tbs, key)));
}

export function pem(der) {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g);
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

const DAY = 86400_000;

/**
 * A P-256 CA, self-signed or (with `parent`) an intermediate the parent signs;
 * pathLen 0 as the realm CA has it, unless it is to sign an intermediate.
 * `issue(host, spki, { notBefore, notAfter, san, eku })` signs a leaf: `san:
 * 'dns'` writes an IP literal as a dNSName, `eku` replaces serverAuth.
 */
export function makeCa(commonName = 'homescoop tls-engine cert CA', { parent, pathLen = 0 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const dn = { organization: 'homescoop', commonName };
  const now = Date.now();
  const der = certificate({
    issuer: parent ? parent.dn : dn,
    subject: dn,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + 365 * DAY),
    spki,
    issuerSpki: parent ? parent.spki : spki,
    ca: true,
    pathLen,
    key: parent ? parent.key : privateKey,
  });
  return {
    der,
    pem: pem(der),
    dn,
    spki,
    key: privateKey,
    issue(host, leafSpki, { notBefore = new Date(now - 3600_000), notAfter = new Date(now + 7 * DAY), san, eku } = {}) {
      return certificate({
        san,
        eku,
        issuer: dn,
        subject: { commonName: host },
        notBefore,
        notAfter,
        spki: leafSpki,
        issuerSpki: spki,
        ca: false,
        host,
        key: privateKey,
      });
    },
  };
}
