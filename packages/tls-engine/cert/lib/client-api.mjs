/**
 * The engine's client sessions, as slicc-kernel's raw TLS will drive them
 * (slicc-kernel#922): a trust store the caller fills (a test CA, the
 * bundled roots.der), a client session fed and drained by hand over a real
 * TCP socket, and Node's TLS server on the other end.
 *
 *   node --test packages/tls-engine/cert/lib/client-api.mjs   # from the repo root
 *
 * The package comes from TLS_ENGINE_PACKAGE (an unpacked package/ directory)
 * or TLS_ENGINE_TGZ (default: .homescoop-out/package.tgz).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { makeCa, pem } from './x509.mjs';

const SCRATCH = 64 * 1024;
const BADARG = -3;
const INSECURE = 1;
const NO_SNI = 2;
const CHAIN_ONLY = 4;
const SUITES = { TLS_AES_128_GCM_SHA256: 0x1301, TLS_AES_256_GCM_SHA384: 0x1302, TLS_CHACHA20_POLY1305_SHA256: 0x1303, 'ECDHE-ECDSA-AES128-GCM-SHA256': 0xc02b, 'ECDHE-ECDSA-AES256-GCM-SHA384': 0xc02c, 'ECDHE-ECDSA-CHACHA20-POLY1305': 0xcca9 };
const VERIFY_FAILED = -0x2700;
const BAD_CERTIFICATE = -0x7a00;
const BADCERT = { EXPIRED: 0x01, CN_MISMATCH: 0x04, NOT_TRUSTED: 0x08, EXT_KEY_USAGE: 0x1000 };

let work;
function packageDir() {
  if (process.env.TLS_ENGINE_PACKAGE) return resolve(process.env.TLS_ENGINE_PACKAGE);
  const tgz = resolve(process.env.TLS_ENGINE_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'tls-engine-client-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

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
    return n > 0 ? this.m.HEAPU8.slice(this.scratch, this.scratch + n) : n;
  }
  text(fn) {
    const out = this.into(fn);
    return out instanceof Uint8Array ? new TextDecoder().decode(out) : '';
  }
  strerror(code) {
    this.m._tls_strerror(code, this.scratch, 256);
    const end = this.m.HEAPU8.indexOf(0, this.scratch);
    return new TextDecoder().decode(this.m.HEAPU8.subarray(this.scratch, end));
  }
  store(ders = []) {
    const ptr = this.m._tls_ca_new();
    assert.ok(ptr);
    for (const der of ders) assert.equal(this.with(der, (p) => this.m._tls_ca_add_der(ptr, p, der.length)), 0);
    return ptr;
  }
  client(ca, servername, { alpn = [], flags = 0 } = {}) {
    const wire = Buffer.concat(alpn.map((name) => Buffer.concat([Buffer.of(name.length), Buffer.from(name)])));
    const name = new TextEncoder().encode(servername);
    const ptr = this.with(name, (n) =>
      wire.length
        ? this.with(wire, (a) => this.m._tls_client_new(ca, n, a, wire.length, flags))
        : this.m._tls_client_new(ca, n, 0, 0, flags)
    );
    return ptr || null;
  }
  ownCert(s, chain, key, pass = '') {
    const der = Buffer.concat(chain.map((c) => Buffer.from(c)));
    const keyBytes = typeof key === 'string' ? Buffer.concat([Buffer.from(key), Buffer.of(0)]) : Buffer.from(key);
    const passBytes = Buffer.from(pass);
    const k = this.m._malloc(keyBytes.length);
    this.m.HEAPU8.set(keyBytes, k);
    const p = this.m._malloc(passBytes.length + 1);
    this.m.HEAPU8.set(passBytes, p);
    try {
      const ret = this.with(der, (c) => this.m._tls_client_cert(s, c, der.length, k, keyBytes.length, p, passBytes.length));
      const wiped = this.m.HEAPU8.subarray(k, k + keyBytes.length).every((b) => b === 0) && this.m.HEAPU8.subarray(p, p + passBytes.length).every((b) => b === 0);
      return { ret, wiped };
    } finally {
      this.m._free(k);
      this.m._free(p);
    }
  }
}

function serverCert(ca, host, opts = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = ca.issue(host, publicKey.export({ type: 'spki', format: 'der' }), opts);
  return { der, cert: pem(der) + ca.pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

const sockets = new Set();

async function listen(options, onSocket = (s) => s.pipe(s)) {
  const seen = { servername: undefined, sessions: 0 };
  let connected;
  const secure = new Promise((r) => {
    connected = r;
  });
  const server = createServer(options, (socket) => {
    seen.servername = socket.servername;
    seen.sessions++;
    onSocket(socket);
    connected();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('tlsClientError', () => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, secure, port: server.address().port };
}

class Wire {
  constructor(e, s, port) {
    this.e = e;
    this.m = e.m;
    this.s = s;
    this.chunks = [];
    this.ended = false;
    this.waiters = [];
    this.socket = tcp(port, '127.0.0.1');
    this.socket.on('data', (d) => this.push(d));
    this.socket.on('end', () => {
      this.ended = true;
      this.wake();
    });
    this.socket.on('error', () => {
      this.ended = true;
      this.wake();
    });
  }
  push(d) {
    this.chunks.push(d);
    this.wake();
  }
  wake() {
    for (const w of this.waiters.splice(0)) w();
  }
  async more() {
    if (!this.chunks.length && !this.ended) await new Promise((r) => this.waiters.push(r));
    if (!this.chunks.length) {
      this.m._tls_feed_eof(this.s);
      return false;
    }
    let chunk = this.chunks.shift();
    const room = this.m._tls_in_room(this.s);
    if (chunk.length > room) {
      this.chunks.unshift(chunk.subarray(room));
      chunk = chunk.subarray(0, room);
    }
    this.e.with(chunk, (p) => this.m._tls_feed(this.s, p, chunk.length));
    return true;
  }
  feedQueued() {
    let fed = 0;
    while (this.chunks.length && this.m._tls_in_room(this.s) > 0) {
      let chunk = this.chunks.shift();
      const room = this.m._tls_in_room(this.s);
      if (chunk.length > room) {
        this.chunks.unshift(chunk.subarray(room));
        chunk = chunk.subarray(0, room);
      }
      fed += this.e.with(chunk, (p) => this.m._tls_feed(this.s, p, chunk.length));
    }
    return fed;
  }
  readBuffered() {
    const parts = [];
    for (;;) {
      const out = this.e.into((p, max) => this.m._tls_read(this.s, p, max));
      this.flush();
      if (!(out instanceof Uint8Array)) return { text: Buffer.concat(parts).toString(), last: out };
      parts.push(out);
    }
  }
  flush() {
    while (this.m._tls_out_size(this.s) > 0) {
      const out = this.e.into((p, max) => this.m._tls_out_take(this.s, p, max));
      if (out instanceof Uint8Array) this.socket.write(out);
    }
  }
  async handshake() {
    for (;;) {
      const r = this.m._tls_handshake(this.s);
      this.flush();
      if (r !== 0) return r;
      if (!(await this.more())) return this.m._tls_handshake(this.s);
    }
  }
  async write(bytes) {
    let at = 0;
    while (at < bytes.length) {
      const piece = bytes.subarray(at, at + 16 * 1024);
      const n = this.e.with(piece, (p) => this.m._tls_write(this.s, p, piece.length));
      assert.ok(n >= 0, `tls_write: ${this.e.strerror(n)}`);
      this.flush();
      at += n;
    }
  }
  async read(length) {
    const parts = [];
    let got = 0;
    while (got < length) {
      const out = this.e.into((p, max) => this.m._tls_read(this.s, p, max));
      this.flush();
      if (out instanceof Uint8Array) {
        parts.push(out);
        got += out.length;
      } else if (out === 0) {
        if (!(await this.more()) && this.m._tls_read(this.s, this.e.scratch, 1) <= 0) break;
      } else break;
    }
    return Buffer.concat(parts);
  }
  get verify() {
    return this.m._tls_verify_result(this.s);
  }
  get alpn() {
    return this.e.text((p, max) => this.m._tls_alpn(this.s, p, max));
  }
  peer(i) {
    const out = this.e.into((p, max) => this.m._tls_peer_der(this.s, i, p, max));
    return out instanceof Uint8Array ? Buffer.from(out) : out;
  }
  close() {
    this.m._tls_close(this.s);
    this.flush();
    this.socket.end();
    this.m._tls_session_free(this.s);
  }
}

let createTlsEngine;
let wasm;
let dir;
let engine;
let ca;
let trust;
const servers = [];

before(async () => {
  dir = packageDir();
  wasm = readFileSync(join(dir, 'dist/slicc-tls-engine.wasm'));
  ({ default: createTlsEngine } = await import(pathToFileURL(join(dir, 'dist/slicc-tls-engine.mjs')).href));
  engine = new Engine(await createTlsEngine({ wasmBinary: wasm }));
  ca = makeCa('homescoop tls-engine client cert CA');
  trust = engine.store([ca.der]);
});

after(() => {
  for (const socket of sockets) socket.destroy();
  for (const s of servers) s.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function server(host, { certOpts, tls = {}, onSocket } = {}) {
  const c = serverCert(ca, host, certOpts);
  const s = await listen({ key: c.key, cert: c.cert, ...tls }, onSocket);
  servers.push(s.server);
  return { ...s, leaf: c.der };
}

async function attempt(port, servername, { store = trust, alpn, flags, own } = {}) {
  const s = engine.client(store, servername, { alpn, flags });
  assert.ok(s, `tls_client_new: ${engine.strerror(engine.m._tls_last_error())}`);
  if (own) assert.equal(engine.ownCert(s, ...own).ret, 0);
  const wire = new Wire(engine, s, port);
  const result = await wire.handshake();
  return { wire, result };
}

describe('client sessions (slicc-kernel#922)', () => {
  for (const [version, code] of [['TLSv1.3', 0x0304], ['TLSv1.2', 0x0303]]) {
    test(`${version}: the chain verifies, ALPN agrees, the peer chain reads back, and 1 MiB goes each way`, async () => {
      const srv = await server('client.test', { tls: { minVersion: version, maxVersion: version, ALPNProtocols: ['http/1.1'] } });
      const { wire, result } = await attempt(srv.port, 'client.test', { alpn: ['h2', 'http/1.1'] });
      assert.equal(result, 1, `handshake: ${engine.strerror(result)}`);
      assert.equal(wire.verify, 0);
      assert.equal(engine.m._tls_version(wire.s), code);
      assert.equal(wire.alpn, 'http/1.1');
      await srv.secure;
      assert.equal(srv.seen.servername, 'client.test');
      assert.equal(engine.m._tls_peer_count(wire.s), 2);
      assert.deepEqual(wire.peer(0), Buffer.from(srv.leaf));
      assert.deepEqual(wire.peer(1), Buffer.from(ca.der));
      assert.equal(wire.peer(2), BADARG);
      const payload = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
      const echoed = wire.read(payload.length);
      await wire.write(payload);
      const back = await echoed;
      assert.equal(createHash('sha256').update(back).digest('hex'), createHash('sha256').update(payload).digest('hex'));
      wire.close();
    });
  }

  test('TLS 1.3: a response buffered behind the NewSessionTickets comes out without more input, and the connection stays open (homescoop#1032)', async () => {
    const response = 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok';
    const srv = await server('client.test', {
      tls: { minVersion: 'TLSv1.3' },
      onSocket: (socket) => socket.on('data', () => socket.write(response)),
    });
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.equal(result, 1);
    for (let i = 0; i < 2; i++) {
      await wire.write(Buffer.from('GET / HTTP/1.1\r\nHost: client.test\r\n\r\n'));
      const until = Date.now() + 2000;
      let got = '';
      while (!got.endsWith('ok') && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 50));
        if (wire.feedQueued() === 0) continue;
        const { text, last } = wire.readBuffered();
        assert.equal(last, 0, engine.strerror(last));
        got += text;
      }
      assert.equal(got, response, `request ${i + 1}`);
      assert.equal(wire.m._tls_in_room(wire.s), 40 * 1024, 'nothing left buffered');
    }
    assert.equal(wire.ended, false, 'the server kept the connection open');
    wire.close();
  });

  test('an absolute name (one trailing dot) is the same host for SNI and the check (homescoop#1033)', async () => {
    const srv = await server('dot.test');
    const { wire, result } = await attempt(srv.port, 'dot.test.');
    assert.equal(result, 1, engine.strerror(result));
    assert.equal(wire.verify, 0);
    await srv.secure;
    assert.equal(srv.seen.servername, 'dot.test');
    wire.close();
  });

  for (const [version, cipher] of [['TLSv1.3', 'TLS_AES_256_GCM_SHA384'], ['TLSv1.2', 'ECDHE-ECDSA-AES128-GCM-SHA256']]) {
    test(`${version}: tls_ciphersuite gives the IANA number of the suite the server picked (#1004)`, async () => {
      const srv = await server('client.test', { tls: { minVersion: version, maxVersion: version, ciphers: cipher, ciphersuites: version === 'TLSv1.3' ? cipher : undefined } });
      const s = engine.client(trust, 'client.test');
      assert.equal(engine.m._tls_ciphersuite(s), 0);
      const wire = new Wire(engine, s, srv.port);
      assert.equal(await wire.handshake(), 1);
      assert.equal(engine.m._tls_ciphersuite(s), SUITES[cipher]);
      wire.close();
    });
  }

  test('a client certificate: a server that requires one accepts it and sees its subject, refuses without, and the key bytes are wiped (#1004)', async () => {
    const seen = [];
    const srv = await server('client.test', {
      tls: { requestCert: true, rejectUnauthorized: true, ca: ca.pem },
      onSocket: (socket) => {
        seen.push(socket.getPeerCertificate().subject?.CN);
        socket.pipe(socket);
      },
    });
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const leaf = ca.issue('client.test', publicKey.export({ type: 'spki', format: 'der' }), { eku: '1.3.6.1.5.5.7.3.2' });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const s = engine.client(trust, 'client.test');
    assert.deepEqual(engine.ownCert(s, [leaf, ca.der], keyPem), { ret: 0, wiped: true });
    assert.equal(engine.ownCert(s, [leaf], keyPem).ret, BADARG);
    const wire = new Wire(engine, s, srv.port);
    const hs = await wire.handshake();
    assert.equal(hs, 1, engine.strerror(hs));
    assert.equal(engine.ownCert(s, [leaf], keyPem).ret, BADARG);
    const back = wire.read(4);
    await wire.write(Buffer.from('mtls'));
    assert.equal((await back).toString(), 'mtls');
    assert.deepEqual(seen, ['client.test']);
    wire.close();
    const bare = await attempt(srv.port, 'client.test');
    let r = bare.result;
    if (r === 1) r = await bare.wire.read(1).then((b) => (b.length ? 1 : -1));
    assert.ok(r < 0, `without a certificate: ${r}`);
    bare.wire.close();
  });

  test('tls_last_alert: the server\'s fatal alert, 116 from a TLS 1.3 server wanting a client certificate and 40 from a TLS 1.2 one; -1 without one and for a server session (slicc-kernel#1004)', async () => {
    const FATAL_ALERT = -0x7780;
    for (const [version, alert] of [['TLSv1.3', 116], ['TLSv1.2', 40]]) {
      const srv = await server('client.test', { tls: { minVersion: version, maxVersion: version, requestCert: true, rejectUnauthorized: true, ca: ca.pem } });
      const { wire, result } = await attempt(srv.port, 'client.test');
      let r = result;
      if (r === 1) {
        assert.equal(engine.m._tls_last_alert(wire.s), -1, 'none before the alert');
        do {
          r = engine.m._tls_read(wire.s, engine.scratch, 1);
          wire.flush();
        } while (r === 0 && (await wire.more()));
      }
      assert.equal(r, FATAL_ALERT, `${version}: ${engine.strerror(r)}`);
      assert.equal(engine.m._tls_last_alert(wire.s), alert, version);
      wire.close();
    }
    const fine = await server('client.test');
    const ok = await attempt(fine.port, 'client.test');
    assert.equal(ok.result, 1);
    assert.equal(engine.m._tls_last_alert(ok.wire.s), -1);
    ok.wire.close();
    const leaf = engine.m._tls_leaf_new();
    const spki = engine.into((p, max) => engine.m._tls_leaf_spki(leaf, p, max));
    const der = ca.issue('server.test', spki);
    assert.equal(engine.with(der, (p) => engine.m._tls_leaf_add_cert(leaf, p, der.length)), 0);
    const host = engine.with(new TextEncoder().encode('server.test\0'), (p) => engine.m._tls_session_new(leaf, p));
    assert.ok(host);
    assert.equal(engine.m._tls_last_alert(host), -1);
    engine.m._tls_session_free(host);
    engine.m._tls_leaf_free(leaf);
  });

  test('a client key: DER, encrypted PEM with its passphrase; refused: a wrong passphrase, a key for another certificate, a chain that is not DER, an empty chain or key (#1004)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const leaf = ca.issue('client.test', publicKey.export({ type: 'spki', format: 'der' }), { eku: '1.3.6.1.5.5.7.3.2' });
    const fresh = () => engine.client(trust, 'client.test');
    assert.equal(engine.ownCert(fresh(), [leaf], privateKey.export({ type: 'pkcs8', format: 'der' })).ret, 0);
    assert.equal(engine.ownCert(fresh(), [leaf], privateKey.export({ type: 'sec1', format: 'der' })).ret, 0);
    const locked = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'open sesame' });
    assert.deepEqual(engine.ownCert(fresh(), [leaf], locked, 'open sesame'), { ret: 0, wiped: true });
    const wrong = engine.ownCert(fresh(), [leaf], locked, 'wrong');
    assert.ok(wrong.ret < 0 && wrong.wiped, `wrong passphrase: ${wrong.ret}`);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    assert.equal(engine.ownCert(fresh(), [leaf], other).ret, BADARG);
    assert.ok(engine.ownCert(fresh(), [Buffer.from('junk')], other).ret < 0);
    assert.equal(engine.ownCert(fresh(), [], other).ret, BADARG);
    assert.equal(engine.ownCert(fresh(), [leaf], new Uint8Array(0)).ret, BADARG);
  });

  test('an RSA client key in PKCS#8 (DER, PEM, encrypted PEM) and PKCS#1 is accepted and authenticates; a mismatched RSA key is refused at tls_client_cert with TLS_BADARG (homescoop#1121)', async () => {
    const seen = [];
    const srv = await server('client.test', {
      tls: { requestCert: true, rejectUnauthorized: true, ca: ca.pem },
      onSocket: (socket) => {
        seen.push(socket.getPeerCertificate().subject?.CN);
        socket.pipe(socket);
      },
    });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const leaf = ca.issue('rsa-client.test', publicKey.export({ type: 'spki', format: 'der' }), { eku: '1.3.6.1.5.5.7.3.2' });
    const fresh = () => engine.client(trust, 'client.test');
    const forms = {
      'PKCS#8 DER': [privateKey.export({ type: 'pkcs8', format: 'der' })],
      'PKCS#8 PEM': [privateKey.export({ type: 'pkcs8', format: 'pem' })],
      'encrypted PKCS#8 PEM': [privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'rsa pass' }), 'rsa pass'],
      'PKCS#1 PEM': [privateKey.export({ type: 'pkcs1', format: 'pem' })],
      'PKCS#1 DER': [privateKey.export({ type: 'pkcs1', format: 'der' })],
    };
    for (const [form, [key, pass]] of Object.entries(forms)) {
      const s = fresh();
      const got = engine.ownCert(s, [leaf, ca.der], key, pass);
      assert.deepEqual(got, { ret: 0, wiped: true }, `${form}: ${engine.strerror(got.ret)}`);
      if (form === 'PKCS#8 PEM') {
        const wire = new Wire(engine, s, srv.port);
        const hs = await wire.handshake();
        assert.equal(hs, 1, `${form} handshake: ${engine.strerror(hs)}`);
        const back = wire.read(3);
        await wire.write(Buffer.from('rsa'));
        assert.equal((await back).toString(), 'rsa');
        wire.close();
      } else engine.m._tls_session_free(s);
    }
    assert.deepEqual(seen, ['rsa-client.test'], 'the server saw the PKCS#8 RSA client certificate');
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const type of ['pkcs8', 'pkcs1']) {
      const r = engine.ownCert(fresh(), [leaf], stranger.export({ type, format: 'pem' }));
      assert.equal(r.ret, BADARG, `a ${type} RSA key for another certificate: ${r.ret} ${engine.strerror(r.ret)}`);
      assert.equal(r.wiped, true);
    }
  });

  test('a server name is its bytes: tls_client_new_name refuses one with a NUL inside, where tls_client_new ends it at the NUL (homescoop#1042)', async () => {
    const named = (bytes, flags = 0) => engine.with(bytes, (p) => engine.m._tls_client_new_name(trust, p, bytes.length, 0, 0, flags)) || null;
    const evil = Buffer.from('client.test\0evil');
    assert.equal(named(evil), null, 'a NUL inside the name');
    assert.equal(engine.m._tls_last_error(), BADARG);
    assert.equal(named(Buffer.from('\0client.test')), null);
    assert.equal(named(Buffer.alloc(0)), null, 'an empty name with verification required');
    assert.equal(named(Buffer.from('x'.repeat(300))), null, 'a name too long for the session');
    const srv = await server('client.test');
    const s = named(Buffer.from('client.test'));
    assert.ok(s, 'a plain name gives a session');
    const wire = new Wire(engine, s, srv.port);
    const hs = await wire.handshake();
    assert.equal(hs, 1, engine.strerror(hs));
    assert.equal(wire.verify, 0);
    await srv.secure;
    assert.equal(srv.seen.servername, 'client.test');
    wire.close();
    const cut = engine.with(evil, (p) => engine.m._tls_client_new(trust, p, 0, 0, 0));
    assert.ok(cut, 'the C-string form sees "client.test" and starts a session (documented)');
    engine.m._tls_session_free(cut);
  });

  test('tls_strerror names the engine\'s own codes, not the Mbed TLS HMAC_DRBG codes that share their values (homescoop#1091)', () => {
    assert.equal(engine.strerror(BADARG), 'tls-engine - bad argument (TLS_BADARG)');
    assert.equal(engine.strerror(-2), 'tls-engine - out of memory (TLS_NOMEM)');
    assert.equal(engine.strerror(-1), 'tls-engine - the peer closed the connection (TLS_EOF)');
    assert.equal(engine.client(0, 'client.test'), null);
    assert.doesNotMatch(engine.strerror(engine.m._tls_last_error()), /HMAC_DRBG|UNKNOWN ERROR CODE/);
  });

  test('TLS_CLIENT_NO_SNI sends no SNI and still refuses a leaf for another host (#1004)', async () => {
    const good = await server('client.test');
    const ok = await attempt(good.port, 'client.test', { flags: NO_SNI });
    assert.equal(ok.result, 1, engine.strerror(ok.result));
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const late = ca.issue('client.test', publicKey.export({ type: 'spki', format: 'der' }), { eku: '1.3.6.1.5.5.7.3.2' });
    assert.equal(engine.ownCert(ok.wire.s, [late], privateKey.export({ type: 'pkcs8', format: 'pem' })).ret, BADARG, 'after the handshake started');
    await good.secure;
    assert.equal(good.seen.servername, false);
    ok.wire.close();
    const wrong = await server('other.test');
    const refused = await attempt(wrong.port, 'client.test', { flags: NO_SNI });
    assert.equal(refused.result, VERIFY_FAILED);
    assert.ok(refused.wire.verify & BADCERT.CN_MISMATCH);
    refused.wire.close();
    const dotted = await attempt(good.port, 'client.test.', { flags: NO_SNI });
    assert.equal(dotted.result, 1);
    dotted.wire.close();
    const ipOk = await server('127.0.0.1');
    const ip = await attempt(ipOk.port, '127.0.0.1', { flags: NO_SNI });
    assert.equal(ip.result, 1);
    ip.wire.close();
    for (const [port, what] of [[good.port, 'a leaf that names the host'], [wrong.port, 'a leaf for another host']]) {
      const failing = engine.client(trust, 'client.test', { flags: NO_SNI });
      assert.equal(engine.m._tls_test_name_check_error(failing), 0);
      const failWire = new Wire(engine, failing, port);
      assert.equal(await failWire.handshake(), VERIFY_FAILED, `a name check that cannot run fails closed: ${what}`);
      assert.ok(failWire.verify & BADCERT.CN_MISMATCH);
      assert.equal(engine.m._tls_test_name_check_error(failing), BADARG, 'not on a session whose handshake started');
      failWire.close();
    }
    const dnsOnly = await server('127.0.0.1', { certOpts: { san: 'dns' } });
    const ipRefused = await attempt(dnsOnly.port, '127.0.0.1', { flags: NO_SNI });
    assert.equal(ipRefused.result, VERIFY_FAILED);
    ipRefused.wire.close();
  });

  test('TLS_CLIENT_VERIFY_CHAIN_ONLY skips only the name: a wrong host connects and says so, an untrusted or expired chain is still refused, and it cannot be combined with INSECURE (#1004)', async () => {
    const wrong = await server('other.test');
    const ok = await attempt(wrong.port, 'client.test', { flags: CHAIN_ONLY });
    assert.equal(ok.result, 1, engine.strerror(ok.result));
    assert.equal(ok.wire.verify, 0);
    assert.equal(engine.m._tls_name_mismatch(ok.wire.s), 1);
    await wrong.secure;
    assert.equal(wrong.seen.servername, 'client.test');
    ok.wire.close();
    const right = await server('client.test');
    const match = await attempt(right.port, 'client.test', { flags: CHAIN_ONLY });
    assert.equal(engine.m._tls_name_mismatch(match.wire.s), 0);
    match.wire.close();
    const c = serverCert(makeCa('untrusted'), 'other.test');
    const untrusted = await listen({ key: c.key, cert: c.cert });
    servers.push(untrusted.server);
    const refused = await attempt(untrusted.port, 'client.test', { flags: CHAIN_ONLY });
    assert.equal(refused.result, VERIFY_FAILED);
    refused.wire.close();
    const day = 86400_000;
    const old = await server('client.test', { certOpts: { notBefore: new Date(Date.now() - 3 * day), notAfter: new Date(Date.now() - day) } });
    const expired = await attempt(old.port, 'client.test', { flags: CHAIN_ONLY });
    assert.equal(expired.result, VERIFY_FAILED);
    expired.wire.close();
    for (const flags of [CHAIN_ONLY | INSECURE, CHAIN_ONLY | INSECURE | NO_SNI, 8, 16 | NO_SNI]) {
      assert.equal(engine.client(trust, 'client.test', { flags }), null, `flags ${flags}`);
      assert.equal(engine.m._tls_last_error(), BADARG);
    }
    for (const flags of [INSECURE | NO_SNI, NO_SNI | CHAIN_ONLY]) {
      const s = engine.client(trust, 'client.test', { flags });
      assert.ok(s, `flags ${flags}`);
      engine.m._tls_session_free(s);
    }
  });

  test('no ALPN offered gives no protocol', async () => {
    const srv = await server('client.test', { tls: { ALPNProtocols: ['h2'] } });
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.equal(result, 1);
    assert.equal(wire.alpn, '');
    wire.close();
  });

  test('refused: a CA the store does not hold', async () => {
    const other = makeCa('another CA');
    const c = serverCert(other, 'client.test');
    const srv = await listen({ key: c.key, cert: c.cert });
    servers.push(srv.server);
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.equal(result, VERIFY_FAILED, engine.strerror(result));
    assert.ok(wire.verify & BADCERT.NOT_TRUSTED, `flags ${wire.verify}`);
    assert.match(engine.text((p, max) => engine.m._tls_verify_info(wire.verify, p, max)), /not correctly signed|trusted/i);
    wire.close();
  });

  test('refused: a leaf for another host name', async () => {
    const srv = await server('other.test');
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.equal(result, VERIFY_FAILED);
    assert.ok(wire.verify & BADCERT.CN_MISMATCH, `flags ${wire.verify}`);
    wire.close();
  });

  test('refused: an expired leaf', async () => {
    const day = 86400_000;
    const srv = await server('client.test', {
      certOpts: { notBefore: new Date(Date.now() - 3 * day), notAfter: new Date(Date.now() - day) },
    });
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.equal(result, VERIFY_FAILED);
    assert.ok(wire.verify & BADCERT.EXPIRED, `flags ${wire.verify}`);
    wire.close();
  });

  test('refused: a leaf whose extendedKeyUsage is clientAuth only', async () => {
    const srv = await server('client.test', { certOpts: { eku: '1.3.6.1.5.5.7.3.2' } });
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.ok(result === VERIFY_FAILED || result === BAD_CERTIFICATE, engine.strerror(result));
    assert.ok(wire.verify & BADCERT.EXT_KEY_USAGE, `flags ${wire.verify}`);
    wire.close();
  });

  test('refused: a server that speaks TLS 1.1 at most', async () => {
    const srv = await server('client.test', {
      tls: { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' },
    });
    const { wire, result } = await attempt(srv.port, 'client.test');
    assert.ok(result < 0, `handshake ${result}`);
    assert.equal(srv.seen.sessions, 0);
    wire.close();
  });

  test('an IP literal sends no SNI and verifies against an iPAddress SAN only', async () => {
    const ip = await server('127.0.0.1');
    const ok = await attempt(ip.port, '127.0.0.1');
    assert.equal(ok.result, 1, engine.strerror(ok.result));
    assert.equal(ok.wire.verify, 0);
    await ip.secure;
    assert.equal(ip.seen.servername, false);
    ok.wire.close();
    const dns = await server('127.0.0.1', { certOpts: { san: 'dns' } });
    const refused = await attempt(dns.port, '127.0.0.1');
    assert.equal(refused.result, VERIFY_FAILED);
    assert.ok(refused.wire.verify & BADCERT.CN_MISMATCH, `flags ${refused.wire.verify}`);
    refused.wire.close();
  });

  test('TLS_CLIENT_INSECURE_SKIP_VERIFY finishes the handshake and still reports the result', async () => {
    const srv = await server('other.test');
    const { wire, result } = await attempt(srv.port, 'client.test', { store: engine.store([]), flags: INSECURE });
    assert.equal(result, 1);
    assert.ok(wire.verify & BADCERT.NOT_TRUSTED);
    assert.ok(wire.verify & BADCERT.CN_MISMATCH);
    wire.close();
  });

  test('no session without a store or a server name while verification is required, nor with unknown flags', () => {
    for (const [store, name, flags] of [[0, 'client.test', 0], [trust, '', 0], [trust, 'client.test', 8]]) {
      assert.equal(engine.client(store, name, { flags }), null);
      assert.equal(engine.m._tls_last_error(), BADARG);
    }
    assert.equal(engine.client(trust, 'client.test', { alpn: ['x'.repeat(300)] }), null);
  });

  test('no resumption: a second connection verifies again and is refused by a server the store does not trust', async () => {
    const good = await server('client.test');
    const first = await attempt(good.port, 'client.test');
    assert.equal(first.result, 1);
    first.wire.close();
    const other = makeCa('a third CA');
    const c = serverCert(other, 'client.test');
    const bad = await listen({ key: c.key, cert: c.cert });
    servers.push(bad.server);
    const second = await attempt(bad.port, 'client.test');
    assert.equal(second.result, VERIFY_FAILED);
    second.wire.close();
  });

  test('roots.der loads as a bundle, and the session verifies with it and a caller root together', async () => {
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).slicc.tls.roots;
    assert.match(meta.date, /^\d{4}-\d{2}-\d{2}$/);
    const bundle = readFileSync(join(dir, meta.file));
    const store = engine.store();
    const added = engine.with(bundle, (p) => engine.m._tls_ca_add_bundle(store, p, bundle.length));
    assert.ok(added > 100, `roots added: ${added}`);
    assert.equal(engine.m._tls_ca_count(store), added);
    let at = 0;
    let parsed = 0;
    while (at < bundle.length) {
      const len = bundle[at + 1] & 0x80 ? bundle.readUIntBE(at + 2, bundle[at + 1] & 0x7f) + 2 + (bundle[at + 1] & 0x7f) : bundle[at + 1] + 2;
      new X509Certificate(bundle.subarray(at, at + len));
      parsed++;
      at += len;
    }
    assert.equal(at, bundle.length);
    assert.ok(added <= parsed);
    assert.equal(engine.with(Buffer.from('garbage'), (p) => engine.m._tls_ca_add_bundle(store, p, 7)) < 0, true);
    assert.equal(engine.with(ca.der, (p) => engine.m._tls_ca_add_der(store, p, ca.der.length)), 0);
    const srv = await server('client.test');
    const { wire, result } = await attempt(srv.port, 'client.test', { store });
    assert.equal(result, 1);
    wire.close();
    engine.m._tls_ca_free(store);
  });

  test('no entropy fails closed: no trust store or session starts, with PSA - Insufficient entropy, and the instance recovers', async () => {
    const m = await createTlsEngine({ wasmBinary: wasm });
    const e = new Engine(m);
    const real = globalThis.crypto.getRandomValues;
    globalThis.crypto.getRandomValues = () => {
      throw new Error('no entropy');
    };
    try {
      assert.equal(m._tls_ca_new(), 0);
      assert.equal(e.strerror(m._tls_last_error()), 'PSA - Insufficient entropy');
      assert.equal(e.client(0, 'client.test', { flags: INSECURE }), null);
      assert.equal(e.strerror(m._tls_last_error()), 'PSA - Insufficient entropy');
    } finally {
      globalThis.crypto.getRandomValues = real;
    }
    const store = e.store([ca.der]);
    const srv = await server('client.test');
    const s = e.client(store, 'client.test');
    assert.ok(s);
    const wire = new Wire(e, s, srv.port);
    assert.equal(await wire.handshake(), 1);
    wire.close();
  });

  test('a store outlives its free while a session holds it', async () => {
    const store = engine.store([ca.der]);
    const srv = await server('client.test');
    const s = engine.client(store, 'client.test');
    engine.m._tls_ca_free(store);
    const wire = new Wire(engine, s, srv.port);
    assert.equal(await wire.handshake(), 1);
    wire.close();
  });
});

describe('tls_chain_verify, a chain checked without a handshake (4.2.0-5, slicc-kernel#1090)', () => {
  const UNVERIFIED = 0xffffffff;
  const leafFor = (host, opts) => serverCert(ca, host, opts).der;
  function verify(chainDers, hostname, store = trust) {
    const chain = Buffer.concat(chainDers.map((d) => Buffer.from(d)));
    const flagsPtr = engine.m._malloc(4);
    engine.m.HEAPU8.fill(0, flagsPtr, flagsPtr + 4);
    try {
      const run = (c) => {
        if (hostname === null) return engine.m._tls_chain_verify(store, c, chain.length, 0, flagsPtr);
        return engine.with(new TextEncoder().encode(hostname), (h) => engine.m._tls_chain_verify(store, c, chain.length, h, flagsPtr));
      };
      const ret = chain.length > 0 ? engine.with(chain, run) : run(0);
      const h = engine.m.HEAPU8;
      const flags = (h[flagsPtr] | (h[flagsPtr + 1] << 8) | (h[flagsPtr + 2] << 16) | (h[flagsPtr + 3] << 24)) >>> 0;
      return { ret, flags };
    } finally {
      engine.m._free(flagsPtr);
    }
  }

  test('a good chain for its host verifies (0/0), an absolute name too; a wrong host is CN_MISMATCH and passes only with a NULL hostname', () => {
    const leaf = leafFor('chain.test');
    assert.deepEqual(verify([leaf, ca.der], 'chain.test'), { ret: 0, flags: 0 });
    assert.deepEqual(verify([leaf], 'chain.test'), { ret: 0, flags: 0 });
    assert.deepEqual(verify([leaf], 'chain.test.'), { ret: 0, flags: 0 });
    assert.deepEqual(verify([leaf], 'other.test'), { ret: 1, flags: BADCERT.CN_MISMATCH });
    assert.deepEqual(verify([leaf], null), { ret: 0, flags: 0 });
    assert.deepEqual(verify([leaf], ''), { ret: 1, flags: BADCERT.CN_MISMATCH });
  });

  test('an untrusted CA, an expired leaf and a clientAuth-only leaf return 1 and are flagged as a session would flag them', () => {
    const other = makeCa('homescoop tls-engine other CA');
    const stranger = other.issue('chain.test', generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }));
    const untrusted = verify([stranger], 'chain.test');
    assert.equal(untrusted.ret, 1);
    assert.equal(untrusted.flags & BADCERT.NOT_TRUSTED, BADCERT.NOT_TRUSTED);
    const day = 86400_000;
    const expired = leafFor('chain.test', { notBefore: new Date(Date.now() - 3 * day), notAfter: new Date(Date.now() - day) });
    const old = verify([expired], 'chain.test');
    assert.equal(old.ret, 1);
    assert.equal(old.flags & BADCERT.EXPIRED, BADCERT.EXPIRED);
    const clientOnly = leafFor('chain.test', { eku: '1.3.6.1.5.5.7.3.2' });
    assert.deepEqual(verify([clientOnly], 'chain.test'), { ret: 1, flags: BADCERT.EXT_KEY_USAGE });
  });

  test('an IP literal verifies only against an iPAddress SAN, never a dNSName spelling it', () => {
    assert.deepEqual(verify([leafFor('192.0.2.9')], '192.0.2.9'), { ret: 0, flags: 0 });
    assert.deepEqual(verify([leafFor('192.0.2.9', { san: 'dns' })], '192.0.2.9'), { ret: 1, flags: BADCERT.CN_MISMATCH });
  });

  test('fails closed: a NULL store, no chain, a truncated DER, garbage and an allocation failure are < 0 with flags that are never 0', () => {
    const leaf = Buffer.from(leafFor('chain.test'));
    for (const [chain, store] of [[[leaf], 0], [[], trust], [[leaf.subarray(0, leaf.length - 7)], trust], [[Buffer.from('not a certificate')], trust]]) {
      const got = verify(chain, 'chain.test', store);
      assert.ok(got.ret < 0, JSON.stringify(got));
      assert.equal(got.flags, UNVERIFIED);
    }
    engine.m._tls_test_chain_verify_alloc_error();
    const oom = verify([leaf], 'chain.test');
    assert.ok(oom.ret < 0);
    assert.equal(oom.flags, UNVERIFIED);
    assert.deepEqual(verify([leaf], 'chain.test'), { ret: 0, flags: 0 });
    assert.equal(engine.m._tls_chain_verify(trust, 0, 0, 0, 0), BADARG);
  });

  test('keeps nothing: 2000 verifications leave the heap where it was', () => {
    const leaf = leafFor('chain.test');
    verify([leaf], 'chain.test');
    const before = engine.m.HEAPU8.length;
    for (let i = 0; i < 2000; i++) assert.equal(verify([leaf, ca.der], 'chain.test').flags, 0);
    assert.equal(engine.m.HEAPU8.length, before);
  });
});
