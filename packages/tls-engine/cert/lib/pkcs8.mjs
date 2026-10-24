import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { connect, createServer } from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCa, pem } from './x509.mjs';

const SCRATCH = 64 * 1024;
const BADARG = -3;
const PK_PASSWORD_REQUIRED = -0x3c00;
const PK_PASSWORD_MISMATCH = -0x3b80;
const PKCS5_FEATURE_UNAVAILABLE = -0x2e80;
const ASN1_UNEXPECTED_TAG = -0x62;
const CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';
const KEYS = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys');

const EC = ['aes-128-cbc', 'aes-192-cbc', 'aes-256-cbc', 'camellia128', 'camellia192', 'camellia256', 'aria-128-cbc', 'aria-192-cbc', 'aria-256-cbc'];
const NEW = new Set(['camellia128', 'camellia192', 'camellia256', 'aria-128-cbc', 'aria-192-cbc', 'aria-256-cbc']);
const FILES = [
  ...EC.map((cipher) => ({ file: `ec-${cipher}.pem`, cipher, pass: `homescoop ${cipher}`, kind: 'EC P-256' })),
  ...['camellia256', 'aria-256-cbc'].map((cipher) => ({ file: `rsa-${cipher}.pem`, cipher, pass: `homescoop rsa ${cipher}`, kind: 'RSA-2048' })),
];
const LUCKY = [
  { file: 'ec-aes-256-cbc.pem', pass: 'wrong 99' },
  { file: 'ec-camellia256.pem', pass: 'wrong 428' },
  { file: 'ec-aria-256-cbc.pem', pass: 'wrong 1268' },
];

const CLIENT = {
  suites: ['1303', '1302', '1301', '1304', '1305', 'cca8', 'cca9', 'c02c', 'c030', 'c0ad', 'c024', 'c028', 'c00a', 'c014', 'c0af', 'c087', 'c08b', 'c073', 'c077', 'c05d', 'c061', 'c049', 'c04d', 'c02b', 'c02f', 'c0ac', 'c023', 'c027', 'c009', 'c013', 'c0ae', 'c086', 'c08a', 'c072', 'c076', 'c05c', 'c060', 'c048', 'c04c', '00ff'],
  groups: ['001d', '0017', '0018', '001e', '0019', '001a', '001b', '001c', '0100', '0101', '0102', '0103', '0104'],
  sigalgs: ['0403', '0503', '0603', '0806', '0805', '0804', '0601', '0501', '0401'],
};
const SERVER_SUITES = {
  ec: ['1301', '1302', '1303', '1304', '1305', 'c009', 'c00a', 'c023', 'c024', 'c02b', 'c02c', 'c048', 'c049', 'c05c', 'c05d', 'c072', 'c073', 'c086', 'c087', 'c0ac', 'c0ad', 'c0ae', 'c0af', 'cca9'],
  rsa: ['1301', '1302', '1303', '1304', '1305', 'c013', 'c014', 'c027', 'c028', 'c02f', 'c030', 'c04c', 'c04d', 'c060', 'c061', 'c076', 'c077', 'c08a', 'c08b', 'cca8'],
};

let work;
function packageDir() {
  if (process.env.TLS_ENGINE_PACKAGE) return resolve(process.env.TLS_ENGINE_PACKAGE);
  const tgz = resolve(process.env.TLS_ENGINE_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'tls-engine-pkcs8-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

const keyFile = (name) => readFileSync(join(KEYS, name), 'utf8');
const pemBody = (text) => Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');

let engine;
let ca;
let store;
let version;

class Engine {
  constructor(m) {
    this.m = m;
    this.scratch = m._malloc(SCRATCH);
  }
  with(bytes, fn) {
    const ptr = this.m._malloc(bytes.length + 1);
    this.m.HEAPU8.set(bytes, ptr);
    this.m.HEAPU8[ptr + bytes.length] = 0;
    try {
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }
  into(fn) {
    const n = fn(this.scratch, SCRATCH);
    return n > 0 ? Buffer.from(this.m.HEAPU8.slice(this.scratch, this.scratch + n)) : n;
  }
  strerror(code) {
    this.m._tls_strerror(code, this.scratch, 256);
    const end = this.m.HEAPU8.indexOf(0, this.scratch);
    return new TextDecoder().decode(this.m.HEAPU8.subarray(this.scratch, end));
  }
  keyCall(key, pass, fn) {
    const k = typeof key === 'string' ? Buffer.concat([Buffer.from(key), Buffer.of(0)]) : Buffer.from(key);
    const p = Buffer.from(pass);
    const kp = this.m._malloc(k.length);
    const pp = this.m._malloc(p.length + 1);
    this.m.HEAPU8.set(k, kp);
    this.m.HEAPU8.set(p, pp);
    try {
      const ret = fn(kp, k.length, pp, p.length);
      const wiped = this.m.HEAPU8.subarray(kp, kp + k.length).every((b) => b === 0) && this.m.HEAPU8.subarray(pp, pp + p.length).every((b) => b === 0);
      return { ret, wiped };
    } finally {
      this.m._free(kp);
      this.m._free(pp);
    }
  }
  importLeaf(chain, key, pass) {
    const der = Buffer.concat(chain);
    const { ret, wiped } = this.keyCall(key, pass, (kp, kl, pp, pl) => this.with(der, (c) => this.m._tls_leaf_import(c, der.length, kp, kl, pp, pl)));
    return { leaf: ret, error: ret ? 0 : this.m._tls_last_error(), wiped };
  }
  client(servername) {
    const name = Buffer.from(servername);
    const s = this.with(name, (n) => this.m._tls_client_new_name(store, n, name.length, 0, 0, 0));
    assert.ok(s, `tls_client_new_name: ${this.strerror(this.m._tls_last_error())}`);
    return s;
  }
  clientCert(s, chain, key, pass) {
    const der = Buffer.concat(chain);
    return this.keyCall(key, pass, (kp, kl, pp, pl) => this.with(der, (c) => this.m._tls_client_cert(s, c, der.length, kp, kl, pp, pl)));
  }
  server(leaf) {
    const s = this.m._tls_server_new(leaf, 0, 0, 0, 0);
    assert.ok(s, `tls_server_new: ${this.strerror(this.m._tls_last_error())}`);
    return s;
  }
  feed(s, bytes) {
    return this.with(bytes, (p) => this.m._tls_feed(s, p, bytes.length));
  }
  drain(s) {
    const parts = [];
    while (this.m._tls_out_size(s) > 0) {
      const out = this.into((p, max) => this.m._tls_out_take(s, p, max));
      if (!Buffer.isBuffer(out)) break;
      parts.push(out);
    }
    return Buffer.concat(parts);
  }
}

function pump(s, role) {
  let pending = Buffer.alloc(0);
  let echoed = Buffer.alloc(0);
  const state = { error: null, sent: false };
  let settle;
  const done = new Promise((r) => {
    settle = r;
  });
  const wire = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      pending = Buffer.concat([pending, chunk]);
      step();
      cb();
    },
    final(cb) {
      cb();
    },
  });
  const flush = () => {
    const out = engine.drain(s);
    if (out.length) wire.push(out);
  };
  function fail(code) {
    state.error = code;
    flush();
    settle();
  }
  function step() {
    for (;;) {
      if (state.error !== null) return;
      if (pending.length) pending = pending.subarray(engine.feed(s, pending));
      if (!engine.m._tls_handshake_done(s)) {
        const r = engine.m._tls_handshake(s);
        flush();
        if (r < 0) return fail(r);
        if (r !== 1) {
          if (pending.length) continue;
          return;
        }
      }
      if (role === 'client' && !state.sent) {
        state.sent = true;
        engine.with(Buffer.from('ping'), (p) => engine.m._tls_write(s, p, 4));
        flush();
      }
      const out = engine.into((p, max) => engine.m._tls_read(s, p, max));
      flush();
      if (Buffer.isBuffer(out)) {
        if (role === 'server') {
          engine.with(out, (p) => engine.m._tls_write(s, p, out.length));
          flush();
        } else {
          echoed = Buffer.concat([echoed, out]);
          if (echoed.toString() === 'ping') settle();
        }
        continue;
      }
      if (out < 0) return fail(out);
      if (pending.length) continue;
      return;
    }
  }
  return { wire, state, done, step, echoed: () => echoed.toString() };
}

async function serveNode(leaf, tlsVersion) {
  const s = engine.server(leaf);
  const link = pump(s, 'server');
  const socket = connect({ socket: link.wire, servername: 'server.test', ca: ca.pem, minVersion: tlsVersion, maxVersion: tlsVersion });
  const outcome = await new Promise((r) => {
    socket.once('secureConnect', () => r({ ok: true }));
    socket.once('error', (err) => r({ ok: false, err }));
  });
  if (outcome.ok) {
    outcome.version = socket.getProtocol();
    outcome.authorized = socket.authorized;
    outcome.peer = socket.getPeerX509Certificate();
    outcome.echo = await new Promise((r) => {
      let got = '';
      socket.on('data', (d) => {
        got += d;
        if (got.length >= 4) r(got);
      });
      socket.once('error', () => r(got));
      socket.write('ping');
    });
  }
  socket.destroy();
  engine.m._tls_session_free(s);
  return outcome;
}

async function mtls(chain, key, pass) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serverLeaf = ca.issue('server.test', pair.publicKey.export({ type: 'spki', format: 'der' }));
  const s = engine.client('server.test');
  const own = engine.clientCert(s, chain, key, pass);
  if (own.ret !== 0) {
    engine.m._tls_session_free(s);
    return { own };
  }
  const link = pump(s, 'client');
  const seen = {};
  const server = createServer({ key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem(serverLeaf) + ca.pem, ca: ca.pem, requestCert: true, rejectUnauthorized: true });
  let socket;
  server.on('secureConnection', (tls) => {
    socket = tls;
    seen.authorized = tls.authorized;
    seen.peer = tls.getPeerX509Certificate();
    tls.on('data', (d) => tls.write(d));
    tls.on('error', (err) => {
      seen.err = err;
    });
  });
  server.on('tlsClientError', (err) => {
    seen.err = err;
  });
  server.emit('connection', link.wire);
  link.step();
  const timeout = new Promise((r) => setTimeout(r, 5000).unref());
  await Promise.race([link.done, timeout]);
  const echoed = link.echoed();
  socket?.destroy();
  link.wire.destroy();
  engine.m._tls_session_free(s);
  return { own, seen, echoed, error: link.state.error };
}

function nodeKey(file, pass) {
  return createPrivateKey({ key: keyFile(file), passphrase: pass });
}

function nodeRefusal(file, pass) {
  try {
    createPrivateKey({ key: keyFile(file), passphrase: pass });
    return 'accepted';
  } catch (err) {
    return err.code;
  }
}

function clientHello() {
  const s = engine.client('server.test');
  assert.equal(engine.m._tls_handshake(s), 0);
  const record = engine.drain(s);
  engine.m._tls_session_free(s);
  assert.equal(record[0], 22, 'a handshake record');
  assert.equal(record[5], 1, 'a ClientHello');
  return record;
}

function parseHello(record) {
  const body = record.subarray(9);
  let at = 2 + 32;
  const sid = body.subarray(at, at + 1 + body[at]);
  at += 1 + body[at];
  const suitesLen = body.readUInt16BE(at);
  const suites = [];
  for (let i = 0; i < suitesLen; i += 2) suites.push(body.readUInt16BE(at + 2 + i));
  at += 2 + suitesLen;
  const compression = body.subarray(at, at + 1 + body[at]);
  at += 1 + body[at];
  const extLen = body.readUInt16BE(at);
  at += 2;
  const extensions = [];
  for (const end = at + extLen; at < end; ) {
    const type = body.readUInt16BE(at);
    const len = body.readUInt16BE(at + 2);
    extensions.push({ type, data: body.subarray(at + 4, at + 4 + len) });
    at += 4 + len;
  }
  return { version: body.subarray(0, 2), random: body.subarray(2, 34), sid, suites, compression, extensions };
}

function u16list(data, skip = 2) {
  const out = [];
  for (let i = skip; i < data.length; i += 2) out.push(data.readUInt16BE(i));
  return out;
}

function buildHello(h, suites, extensions) {
  const suiteBytes = Buffer.alloc(2 + 2 * suites.length);
  suiteBytes.writeUInt16BE(2 * suites.length, 0);
  suites.forEach((c, i) => suiteBytes.writeUInt16BE(c, 2 + 2 * i));
  const ext = Buffer.concat(extensions.map(({ type, data }) => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(data.length, 2);
    return Buffer.concat([head, data]);
  }));
  const extHead = Buffer.alloc(2);
  extHead.writeUInt16BE(ext.length, 0);
  const body = Buffer.concat([h.version, h.random, h.sid, suiteBytes, h.compression, extHead, ext]);
  const hs = Buffer.concat([Buffer.of(1, body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff), body]);
  const rec = Buffer.alloc(5);
  rec[0] = 22;
  rec.writeUInt16BE(0x0303, 1);
  rec.writeUInt16BE(hs.length, 3);
  return Buffer.concat([rec, hs]);
}

function serverPicks(leaf, hello) {
  const s = engine.server(leaf);
  engine.feed(s, hello);
  engine.m._tls_handshake(s);
  const out = engine.drain(s);
  engine.m._tls_session_free(s);
  if (out.length < 6 || out[0] !== 22 || out[5] !== 2) return null;
  const body = out.subarray(9);
  const at = 2 + 32 + 1 + body[34];
  return body.readUInt16BE(at);
}

before(async () => {
  const dir = packageDir();
  version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  console.log(`pkcs8: @ai-ecoverse/wasm-tls-engine@${version} from ${dir}`);
  const { default: createTlsEngine } = await import(pathToFileURL(join(dir, 'dist/slicc-tls-engine.mjs')).href);
  engine = new Engine(await createTlsEngine({ wasmBinary: readFileSync(join(dir, 'dist/slicc-tls-engine.wasm')) }));
  ca = makeCa('homescoop tls-engine pkcs8 CA');
  store = engine.m._tls_ca_new();
  assert.equal(engine.with(ca.der, (p) => engine.m._tls_ca_add_der(store, p, ca.der.length)), 0);
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('PKCS#8 PBES2 keys encrypted with AES, Camellia and ARIA (homescoop#1811)', () => {
  for (const { file, cipher, pass, kind } of FILES) {
    const tag = `${kind}, openssl pkcs8 -topk8 -v2 ${cipher}${NEW.has(cipher) ? ' (new)' : ''}`;

    test(`${tag}: tls_leaf_import loads cert/keys/${file} with its passphrase, Node's createPrivateKey of the same file is the same key, and the leaf serves Node over TLS 1.3 and 1.2`, async () => {
      const key = nodeKey(file, pass);
      const leaf = ca.issue('server.test', createPublicKey(key).export({ type: 'spki', format: 'der' }));
      const r = engine.importLeaf([leaf, ca.der], keyFile(file), pass);
      assert.ok(r.leaf, `tls_leaf_import: ${r.error} ${engine.strerror(r.error)}`);
      assert.equal(r.wiped, true, 'the key and passphrase bytes are wiped');
      for (const tlsVersion of ['TLSv1.3', 'TLSv1.2']) {
        const got = await serveNode(r.leaf, tlsVersion);
        assert.equal(got.ok, true, `${tlsVersion}: ${got.err?.code} ${got.err?.message}`);
        assert.equal(got.version, tlsVersion);
        assert.equal(got.authorized, true);
        assert.deepEqual(got.peer.raw, Buffer.from(leaf));
        assert.equal(got.echo, 'ping');
      }
      engine.m._tls_leaf_free(r.leaf);
    });

    test(`${tag}: tls_client_cert takes cert/keys/${file} and a Node server requiring a client certificate verifies it`, async () => {
      const key = nodeKey(file, pass);
      const leaf = ca.issue('client.test', createPublicKey(key).export({ type: 'spki', format: 'der' }), { eku: CLIENT_AUTH });
      const got = await mtls([leaf, ca.der], keyFile(file), pass);
      assert.equal(got.own.ret, 0, `tls_client_cert: ${got.own.ret} ${engine.strerror(got.own.ret)}`);
      assert.equal(got.own.wiped, true);
      assert.equal(got.error, null, `handshake: ${got.error} ${engine.strerror(got.error ?? 0)}`);
      assert.equal(got.seen.authorized, true, `Node: ${got.seen.err?.message}`);
      assert.deepEqual(got.seen.peer.raw, Buffer.from(leaf));
      assert.equal(got.echoed, 'ping');
    });
  }

  test('an encrypted DER key (Camellia-128, the PEM body of cert/keys/ec-camellia128.pem) loads with its passphrase and is refused with a wrong one', () => {
    const file = 'ec-camellia128.pem';
    const pass = 'homescoop camellia128';
    const leaf = ca.issue('server.test', createPublicKey(nodeKey(file, pass)).export({ type: 'spki', format: 'der' }));
    const der = pemBody(keyFile(file));
    const ok = engine.importLeaf([leaf], der, pass);
    assert.ok(ok.leaf, `${ok.error} ${engine.strerror(ok.error)}`);
    engine.m._tls_leaf_free(ok.leaf);
    const wrong = engine.importLeaf([leaf], der, 'not the passphrase');
    assert.deepEqual([wrong.leaf, wrong.error, wrong.wiped], [0, PK_PASSWORD_MISMATCH, true]);
  });

  test('a wrong passphrase is MBEDTLS_ERR_PK_PASSWORD_MISMATCH for every AES, Camellia and ARIA key, at tls_leaf_import and tls_client_cert, where Node says ERR_OSSL_BAD_DECRYPT; no passphrase is PASSWORD_REQUIRED', () => {
    for (const { file, pass } of FILES) {
      const leaf = ca.issue('server.test', createPublicKey(nodeKey(file, pass)).export({ type: 'spki', format: 'der' }));
      const imported = engine.importLeaf([leaf], keyFile(file), 'not the passphrase');
      assert.deepEqual([imported.leaf, imported.error, imported.wiped], [0, PK_PASSWORD_MISMATCH, true], `${file}: ${engine.strerror(imported.error)}`);
      const s = engine.client('server.test');
      const own = engine.clientCert(s, [leaf], keyFile(file), 'not the passphrase');
      engine.m._tls_session_free(s);
      assert.deepEqual(own, { ret: PK_PASSWORD_MISMATCH, wiped: true }, file);
      assert.equal(nodeRefusal(file, 'not the passphrase'), 'ERR_OSSL_BAD_DECRYPT', file);
      const none = engine.importLeaf([leaf], keyFile(file), '');
      assert.deepEqual([none.leaf, none.error], [0, PK_PASSWORD_REQUIRED], file);
    }
    assert.equal(engine.strerror(PK_PASSWORD_MISMATCH), 'PK - Given private key password does not allow for correct decryption');
  });

  test('about 1 wrong passphrase in 256 passes the PKCS#7 padding check: these fixed ones (AES, Camellia, ARIA) are refused with the ASN.1 error of the garbage they decrypt to (MBEDTLS_ERR_ASN1_UNEXPECTED_TAG), not accepted and not PASSWORD_MISMATCH, and Node refuses them with a decoder or ASN.1 error (ERR_OSSL_UNSUPPORTED or ERR_OSSL_ASN1_*, by OpenSSL version), never ERR_OSSL_BAD_DECRYPT', () => {
    for (const { file, pass } of LUCKY) {
      const right = FILES.find((f) => f.file === file);
      const leaf = ca.issue('server.test', createPublicKey(nodeKey(file, right.pass)).export({ type: 'spki', format: 'der' }));
      const r = engine.importLeaf([leaf], keyFile(file), pass);
      assert.equal(r.leaf, 0, `${file} with '${pass}' was accepted`);
      assert.notEqual(r.error, PK_PASSWORD_MISMATCH, `${file} with '${pass}': the padding check should have passed`);
      assert.deepEqual([r.error, engine.strerror(r.error)], [ASN1_UNEXPECTED_TAG, 'ASN1 - ASN1 tag was of an unexpected value'], `${file} with '${pass}'`);
      const node = nodeRefusal(file, pass);
      assert.notEqual(node, 'accepted', `Node accepted ${file} with '${pass}'`);
      assert.notEqual(node, 'ERR_OSSL_BAD_DECRYPT', file);
      assert.match(node, /^ERR_OSSL_(ASN1_[A-Z_]+|UNSUPPORTED)$/, file);
    }
  });

  test('3DES stays unsupported: a -v2 des3 key is refused with MBEDTLS_ERR_PKCS5_FEATURE_UNAVAILABLE with the right passphrase and with a wrong one, where Node takes it', () => {
    const file = 'ec-des3.pem';
    const pass = 'homescoop des3';
    const key = nodeKey(file, pass);
    assert.equal(nodeRefusal(file, 'not the passphrase'), 'ERR_OSSL_BAD_DECRYPT');
    const leaf = ca.issue('server.test', createPublicKey(key).export({ type: 'spki', format: 'der' }));
    for (const p of [pass, 'not the passphrase']) {
      const r = engine.importLeaf([leaf], keyFile(file), p);
      assert.deepEqual([r.leaf, r.error, r.wiped], [0, PKCS5_FEATURE_UNAVAILABLE, true], `'${p}': ${engine.strerror(r.error)}`);
      const s = engine.client('server.test');
      const own = engine.clientCert(s, [leaf], keyFile(file), p);
      engine.m._tls_session_free(s);
      assert.deepEqual(own, { ret: PKCS5_FEATURE_UNAVAILABLE, wiped: true }, p);
    }
    assert.equal(engine.strerror(PKCS5_FEATURE_UNAVAILABLE), 'PKCS5 - Requested encryption or digest alg not available');
  });

  test('a decrypted key for another type of certificate is TLS_BADARG: the EC Camellia key for an RSA leaf and the RSA ARIA key for an EC leaf (homescoop#1041)', () => {
    const ecKey = nodeKey('ec-camellia256.pem', 'homescoop camellia256');
    const rsaKey = nodeKey('rsa-aria-256-cbc.pem', 'homescoop rsa aria-256-cbc');
    const ecLeaf = ca.issue('client.test', createPublicKey(ecKey).export({ type: 'spki', format: 'der' }), { eku: CLIENT_AUTH });
    const rsaLeaf = ca.issue('client.test', createPublicKey(rsaKey).export({ type: 'spki', format: 'der' }), { eku: CLIENT_AUTH });
    for (const [leaf, file, pass] of [[rsaLeaf, 'ec-camellia256.pem', 'homescoop camellia256'], [ecLeaf, 'rsa-aria-256-cbc.pem', 'homescoop rsa aria-256-cbc']]) {
      const s = engine.client('server.test');
      assert.deepEqual(engine.clientCert(s, [leaf], keyFile(file), pass), { ret: BADARG, wiped: true }, file);
      engine.m._tls_session_free(s);
      const r = engine.importLeaf([leaf], keyFile(file), pass);
      assert.deepEqual([r.leaf, r.error], [0, BADARG], file);
    }
  });
});

describe('the TLS configuration is 4.2.0-11\'s: the patch adds PBES2 OIDs only (homescoop#1811)', () => {
  test('a client session offers the same cipher suites, groups and signature algorithms, in the same order', () => {
    const h = parseHello(clientHello());
    const hex = (list) => list.map((c) => c.toString(16).padStart(4, '0'));
    const offered = {
      suites: hex(h.suites),
      groups: hex(u16list(h.extensions.find((e) => e.type === 10).data)),
      sigalgs: hex(u16list(h.extensions.find((e) => e.type === 13).data)),
    };
    assert.deepEqual(offered, CLIENT, JSON.stringify(offered));
  });

  test('a server session with an EC or an RSA leaf accepts the same suites: each one offered alone (Camellia, ARIA, CBC and every other code of 0x0000-0x00ff, 0x1300-0x13ff, 0xc000-0xc0ff, 0xcc00-0xccff, 0xd000-0xd0ff), on TLS 1.3 for 0x13xx and TLS 1.2 otherwise', () => {
    const h = parseHello(clientHello());
    const without12 = h.extensions.filter((e) => e.type !== 43);
    const candidates = [];
    for (const base of [0x0000, 0x1300, 0xc000, 0xcc00, 0xd000]) for (let i = 0; i < 0x100; i++) if (base + i !== 0x00ff) candidates.push(base + i);
    const leaves = {
      ec: generateKeyPairSync('ec', { namedCurve: 'P-256' }),
      rsa: generateKeyPairSync('rsa', { modulusLength: 2048 }),
    };
    for (const [kind, pair] of Object.entries(leaves)) {
      const leafDer = ca.issue('server.test', pair.publicKey.export({ type: 'spki', format: 'der' }));
      const r = engine.importLeaf([leafDer], pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), '');
      assert.ok(r.leaf, `${kind}: ${engine.strerror(r.error)}`);
      const accepted = [];
      for (const code of candidates) {
        const tls13 = code >> 8 === 0x13;
        const hello = buildHello(h, [code, 0x00ff], tls13 ? h.extensions : without12);
        const picked = serverPicks(r.leaf, hello);
        if (picked !== null) {
          assert.equal(picked, code, `${kind}: offered ${code.toString(16)}, picked ${picked.toString(16)}`);
          accepted.push(code);
        }
      }
      engine.m._tls_leaf_free(r.leaf);
      const hex = accepted.map((c) => c.toString(16).padStart(4, '0'));
      assert.deepEqual(hex, SERVER_SUITES[kind], `${kind}: ${JSON.stringify(hex)}`);
    }
  });
});
