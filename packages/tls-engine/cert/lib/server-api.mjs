import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { makeCa, pem, selfSigned } from './x509.mjs';

const SCRATCH = 64 * 1024;
const EOF = -1;
const BADARG = -3;
const TOO_LARGE = -0x10000;
const REQUEST_CERT = 1;
const REQUIRE_CERT = 2;
const NOT_TRUSTED = 0x08;
const CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';
const NEW_EXPORTS = ['_tls_leaf_import', '_tls_server_new', '_tls_sni'];

let work;
function packageDir() {
  if (process.env.TLS_ENGINE_PACKAGE) return resolve(process.env.TLS_ENGINE_PACKAGE);
  const tgz = resolve(process.env.TLS_ENGINE_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'tls-engine-server-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

const wireAlpn = (names) => Buffer.concat(names.map((n) => Buffer.concat([Buffer.of(n.length), Buffer.from(n)])));
const keyBytes = (key) => (typeof key === 'string' ? Buffer.concat([Buffer.from(key), Buffer.of(0)]) : Buffer.from(key));

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
    return out instanceof Uint8Array ? new TextDecoder().decode(out) : out;
  }
  strerror(code) {
    this.m._tls_strerror(code, this.scratch, 256);
    const end = this.m.HEAPU8.indexOf(0, this.scratch);
    return new TextDecoder().decode(this.m.HEAPU8.subarray(this.scratch, end));
  }
  get error() {
    return this.m._tls_last_error();
  }
  store(ders) {
    const ptr = this.m._tls_ca_new();
    assert.ok(ptr);
    for (const der of ders) assert.equal(this.with(der, (p) => this.m._tls_ca_add_der(ptr, p, der.length)), 0);
    return ptr;
  }
  importLeaf(chain, key, pass = '') {
    const der = Buffer.concat(chain.map((c) => Buffer.from(c)));
    const k = keyBytes(key);
    const passBytes = Buffer.from(pass);
    const kp = this.m._malloc(k.length);
    this.m.HEAPU8.set(k, kp);
    const pp = this.m._malloc(passBytes.length + 1);
    this.m.HEAPU8.set(passBytes, pp);
    try {
      const leaf = der.length
        ? this.with(der, (c) => this.m._tls_leaf_import(c, der.length, kp, k.length, pp, passBytes.length))
        : this.m._tls_leaf_import(0, 0, kp, k.length, pp, passBytes.length);
      const wiped = this.m.HEAPU8.subarray(kp, kp + k.length).every((b) => b === 0) && this.m.HEAPU8.subarray(pp, pp + passBytes.length).every((b) => b === 0);
      return { leaf, error: leaf ? 0 : this.error, wiped };
    } finally {
      this.m._free(kp);
      this.m._free(pp);
    }
  }
  server(leaf, { alpn = [], ca = 0, flags = 0 } = {}) {
    const wire = wireAlpn(alpn);
    const ptr = wire.length
      ? this.with(wire, (a) => this.m._tls_server_new(leaf, a, wire.length, ca, flags))
      : this.m._tls_server_new(leaf, 0, 0, ca, flags);
    return ptr ? new Session(this, ptr) : null;
  }
}

class Session {
  constructor(e, ptr) {
    this.e = e;
    this.m = e.m;
    this.ptr = ptr;
  }
  feed(bytes) {
    return this.e.with(bytes, (p) => this.m._tls_feed(this.ptr, p, bytes.length));
  }
  read() {
    const out = this.e.into((p, max) => this.m._tls_read(this.ptr, p, max));
    if (out instanceof Uint8Array) return out;
    if (out === 0) return 'more';
    if (out === EOF) return 'eof';
    return out;
  }
  write(bytes) {
    return this.e.with(bytes, (p) => this.m._tls_write(this.ptr, p, bytes.length));
  }
  take() {
    if (this.m._tls_out_size(this.ptr) === 0) return null;
    const out = this.e.into((p, max) => this.m._tls_out_take(this.ptr, p, max));
    return out instanceof Uint8Array ? out : null;
  }
  get done() {
    return this.m._tls_handshake_done(this.ptr) !== 0;
  }
  get alpn() {
    const out = this.e.text((p, max) => this.m._tls_alpn(this.ptr, p, max));
    return out === 0 ? '' : out;
  }
  get sni() {
    const out = this.e.text((p, max) => this.m._tls_sni(this.ptr, p, max));
    return out === 0 ? '' : out;
  }
  get version() {
    return this.m._tls_version(this.ptr);
  }
  get verify() {
    return this.m._tls_verify_result(this.ptr);
  }
  get peers() {
    const n = this.m._tls_peer_count(this.ptr);
    const out = [];
    for (let i = 0; i < n; i++) out.push(Buffer.from(this.e.into((p, max) => this.m._tls_peer_der(this.ptr, i, p, max))));
    return out;
  }
  free() {
    this.m._tls_session_free(this.ptr);
  }
}

function tunnel(session) {
  let pending = Buffer.alloc(0);
  let ended = false;
  const state = { error: null, eof: false };
  const wire = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      pending = Buffer.concat([pending, chunk]);
      pump();
      cb();
    },
    final(cb) {
      ended = true;
      pump();
      cb();
    },
  });
  const flush = () => {
    for (let out = session.take(); out; out = session.take()) wire.push(Buffer.from(out));
  };
  function pump() {
    for (;;) {
      if (state.error !== null || state.eof) return;
      if (pending.length) pending = pending.subarray(session.feed(pending));
      const got = session.read();
      flush();
      if (got instanceof Uint8Array) {
        for (let at = 0; at < got.length; ) {
          const n = session.write(Buffer.from(got.subarray(at)));
          assert.ok(n >= 0, `tls_write: ${n}`);
          flush();
          at += n;
        }
        continue;
      }
      if (got === 'eof' || typeof got === 'number') {
        if (got === 'eof') state.eof = true;
        else state.error = got;
        wire.push(null);
        return;
      }
      if (pending.length) continue;
      if (ended) {
        session.m._tls_feed_eof(session.ptr);
        ended = false;
        continue;
      }
      return;
    }
  }
  return { wire, state };
}

function echo(socket, text) {
  return new Promise((resolve, reject) => {
    let got = '';
    const onData = (d) => {
      got += d;
      if (got.length >= text.length) {
        socket.off('data', onData);
        resolve(got);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.once('end', () => resolve(got));
    socket.write(text);
  });
}

async function serve(session, { anyName, ...options }) {
  const { wire, state } = tunnel(session);
  const socket = connect({ socket: wire, ...options, ...(anyName ? { checkServerIdentity: () => undefined } : {}) });
  const outcome = await new Promise((resolve) => {
    socket.once('secureConnect', () => resolve({ ok: true }));
    socket.once('error', (err) => resolve({ ok: false, err }));
  });
  if (outcome.ok) {
    try {
      outcome.echoed = await echo(socket, 'ping');
    } catch (err) {
      outcome.ok = false;
      outcome.err = err;
    }
  }
  socket.destroy();
  return { ...outcome, state, alpn: socket.alpnProtocol, authorized: socket.authorized };
}

const served = (r) => r.ok && r.echoed === 'ping' && r.state.error === null;

let engine;
let wasm;
let createTlsEngine;
let clientCa;
let clientStore;
let ecLeaf;
let rsaLeaf;

before(async () => {
  const dir = packageDir();
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  console.log(`server-api: ${manifest.name}@${manifest.version} from ${dir}`);
  ({ default: createTlsEngine } = await import(pathToFileURL(join(dir, 'dist/slicc-tls-engine.mjs')).href));
  wasm = readFileSync(join(dir, 'dist/slicc-tls-engine.wasm'));
  engine = new Engine(await createTlsEngine({ wasmBinary: wasm }));
  for (const name of NEW_EXPORTS) assert.equal(typeof engine.m[name], 'function', `${manifest.version} has no ${name}`);
  clientCa = makeCa('homescoop tls-engine client CA');
  clientStore = engine.store([clientCa.der]);
  ecLeaf = selfSigned('server.test');
  rsaLeaf = selfSigned('server.test', { type: 'rsa', modulusLength: 2048 });
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

function imported(cert, key = cert.key.export({ type: 'pkcs8', format: 'pem' }), pass) {
  const r = engine.importLeaf([cert.der], key, pass);
  assert.ok(r.leaf, `tls_leaf_import: ${r.error} ${engine.strerror(r.error)}`);
  assert.equal(r.wiped, true, 'the key and passphrase bytes are wiped');
  return r.leaf;
}

function clientCert(ca = clientCa, cn = 'client.test', eku = CLIENT_AUTH) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = ca.issue(cn, publicKey.export({ type: 'spki', format: 'der' }), { eku });
  return { der, cert: pem(der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

describe('tls_leaf_import: the caller\'s chain and key (homescoop#1638)', () => {
  for (const [kind, version] of [['EC', 'TLSv1.3'], ['EC', 'TLSv1.2'], ['RSA', 'TLSv1.3'], ['RSA', 'TLSv1.2']]) {
    test(`an imported ${kind} leaf serves Node's tls.connect with ca set to the self-signed cert over ${version}`, async () => {
      const cert = kind === 'EC' ? ecLeaf : rsaLeaf;
      const leaf = imported(cert);
      const session = engine.server(leaf);
      engine.m._tls_leaf_free(leaf);
      assert.ok(session, `tls_server_new: ${engine.strerror(engine.error)}`);
      const r = await serve(session, { servername: 'server.test', ca: cert.pem, minVersion: version, maxVersion: version });
      assert.ok(served(r), `handshake: ${r.err?.code ?? r.err} engine ${r.state.error} ${engine.strerror(r.state.error ?? 0)}`);
      assert.equal(r.authorized, true);
      assert.equal(session.version, version === 'TLSv1.3' ? 0x0304 : 0x0303);
      assert.equal(session.alpn, '', 'no ALPN offered, none agreed');
      session.free();
    });
  }

  test('key forms: PKCS#8 DER and PEM, encrypted PKCS#8 with its passphrase, PKCS#1, SEC1, P-384; the chain goes out whole', async () => {
    const rsaKey = rsaLeaf.key;
    const forms = [
      ['RSA PKCS#8 DER', rsaLeaf, rsaKey.export({ type: 'pkcs8', format: 'der' })],
      ['RSA PKCS#1 PEM', rsaLeaf, rsaKey.export({ type: 'pkcs1', format: 'pem' })],
      ['RSA PKCS#1 DER', rsaLeaf, rsaKey.export({ type: 'pkcs1', format: 'der' })],
      ['RSA encrypted PKCS#8 PEM', rsaLeaf, rsaKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'rsa secret' }), 'rsa secret'],
      ['EC SEC1 PEM', ecLeaf, ecLeaf.key.export({ type: 'sec1', format: 'pem' })],
      ['EC SEC1 DER', ecLeaf, ecLeaf.key.export({ type: 'sec1', format: 'der' })],
      ['EC encrypted PKCS#8 PEM', ecLeaf, ecLeaf.key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'ec secret' }), 'ec secret'],
    ];
    for (const [form, cert, key, pass] of forms) {
      const r = engine.importLeaf([cert.der], key, pass);
      assert.ok(r.leaf, `${form}: ${r.error} ${engine.strerror(r.error)}`);
      assert.equal(r.wiped, true, form);
      engine.m._tls_leaf_free(r.leaf);
    }
    const p384 = selfSigned('p384.test', { type: 'ec', namedCurve: 'P-384' });
    const leaf384 = imported(p384);
    const s384 = engine.server(leaf384);
    engine.m._tls_leaf_free(leaf384);
    assert.ok(served(await serve(s384, { servername: 'p384.test', ca: p384.pem })), 'P-384 leaf');
    s384.free();
    const root = makeCa('homescoop tls-engine server root', { pathLen: 1 });
    const mid = makeCa('homescoop tls-engine server intermediate', { parent: root });
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const leafDer = mid.issue('chain.test', publicKey.export({ type: 'spki', format: 'der' }));
    const r = engine.importLeaf([leafDer, mid.der], privateKey.export({ type: 'pkcs8', format: 'der' }));
    assert.ok(r.leaf, engine.strerror(r.error));
    const s = engine.server(r.leaf);
    engine.m._tls_leaf_free(r.leaf);
    const got = await serve(s, { servername: 'chain.test', ca: root.pem });
    assert.ok(served(got), `a root-only client and the imported chain: ${got.err?.code}`);
    s.free();
  });

  test('refused at import: a wrong passphrase, a key for another certificate, an RSA key over 8192 bits, an empty chain or key; no key bytes in tls_strerror', () => {
    const secret = 'correct horse battery staple';
    const locked = rsaLeaf.key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: secret });
    const keyText = rsaLeaf.key.export({ type: 'pkcs8', format: 'pem' });
    const keyDerHex = rsaLeaf.key.export({ type: 'pkcs8', format: 'der' }).toString('hex');
    const texts = [];
    const wrong = engine.importLeaf([rsaLeaf.der], locked, 'not the passphrase');
    assert.equal(wrong.leaf, 0, 'a wrong passphrase');
    assert.ok(wrong.error < 0 && wrong.error !== BADARG, `a wrong passphrase is Mbed TLS's error: ${wrong.error}`);
    assert.match(engine.strerror(wrong.error), /^PK - /);
    assert.equal(wrong.wiped, true);
    texts.push(engine.strerror(wrong.error));
    const none = engine.importLeaf([rsaLeaf.der], locked);
    assert.equal(none.leaf, 0, 'an encrypted key without its passphrase');
    texts.push(engine.strerror(none.error));
    for (const [cert, other] of [[rsaLeaf, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey], [ecLeaf, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey], [ecLeaf, rsaLeaf.key]]) {
      const r = engine.importLeaf([cert.der], other.export({ type: 'pkcs8', format: 'pem' }));
      assert.equal(r.leaf, 0, 'a key for another certificate');
      assert.equal(r.error, BADARG, `a key for another certificate: ${r.error} ${engine.strerror(r.error)}`);
      assert.equal(r.wiped, true);
      texts.push(engine.strerror(r.error));
    }
    const modulus = randomBytes(1025);
    modulus[0] = 0x80;
    modulus[1024] |= 1;
    const huge = createPublicKey({ key: { kty: 'RSA', n: modulus.toString('base64url'), e: 'AQAB' }, format: 'jwk' });
    const big = makeCa('homescoop tls-engine big CA').issue('rsa8200.test', huge.export({ type: 'spki', format: 'der' }));
    const tooLarge = engine.importLeaf([big], keyText);
    assert.equal(tooLarge.leaf, 0);
    assert.equal(tooLarge.error, TOO_LARGE, `an 8200-bit RSA leaf: ${tooLarge.error} ${engine.strerror(tooLarge.error)}`);
    texts.push(engine.strerror(tooLarge.error));
    assert.equal(engine.importLeaf([], keyText).error, BADARG, 'no chain');
    assert.equal(engine.importLeaf([rsaLeaf.der], new Uint8Array(0)).error, BADARG, 'no key');
    assert.ok(engine.importLeaf([Buffer.from('not a certificate')], keyText).error < 0, 'a chain that is not DER');
    const body = keyText.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
    for (const text of texts) {
      assert.doesNotMatch(text, /UNKNOWN ERROR CODE/, text);
      assert.ok(!text.includes(secret) && !text.includes('not the passphrase'), `a passphrase in ${text}`);
      for (let i = 0; i + 16 <= body.length; i += 16) assert.ok(!text.includes(body.slice(i, i + 16)), `key bytes in ${text}`);
      for (let i = 0; i + 16 <= keyDerHex.length; i += 16) assert.ok(!text.toLowerCase().includes(keyDerHex.slice(i, i + 16)), `key bytes in ${text}`);
    }
  });

  test('an imported leaf serves many sessions, outlives its tls_leaf_free while a session holds it, and 300 cycles keep the heap where it was', async () => {
    const leaf = imported(ecLeaf);
    const a = engine.server(leaf);
    const b = engine.server(leaf);
    engine.m._tls_leaf_free(leaf);
    for (const s of [a, b]) {
      assert.ok(served(await serve(s, { servername: 'server.test', ca: ecLeaf.pem })));
      s.free();
    }
    const key = ecLeaf.key.export({ type: 'pkcs8', format: 'der' });
    const cycle = () => {
      const r = engine.importLeaf([ecLeaf.der], key);
      const s = engine.server(r.leaf, { alpn: ['h2'], ca: clientStore, flags: REQUIRE_CERT });
      engine.m._tls_leaf_free(r.leaf);
      s.free();
    };
    for (let i = 0; i < 50; i++) cycle();
    const heap = engine.m.HEAPU8.length;
    for (let i = 0; i < 300; i++) cycle();
    assert.equal(engine.m.HEAPU8.length, heap, 'the heap grew');
  });
});

describe('tls_server_new: ALPN, SNI, client certificates (homescoop#1638)', () => {
  test('ALPN: with ["h2", "http/1.1"] offered, the client\'s choice is agreed (the server\'s order when the client offers both) and tls_alpn gives it', async () => {
    const leaf = imported(ecLeaf);
    for (const [offered, agreed] of [[['http/1.1'], 'http/1.1'], [['h2'], 'h2'], [['h2', 'http/1.1'], 'h2'], [['http/1.1', 'h2'], 'h2'], [[], '']]) {
      for (const version of ['TLSv1.3', 'TLSv1.2']) {
        const s = engine.server(leaf, { alpn: ['h2', 'http/1.1'] });
        const r = await serve(s, { servername: 'server.test', ca: ecLeaf.pem, ALPNProtocols: offered.length ? offered : undefined, minVersion: version, maxVersion: version });
        assert.ok(served(r), `${offered} ${version}: ${r.err?.code}`);
        assert.equal(s.alpn, agreed, `${offered} ${version}: tls_alpn`);
        assert.equal(r.alpn || '', agreed, `${offered} ${version}: the client's view`);
        s.free();
      }
    }
    engine.m._tls_leaf_free(leaf);
  });

  test('ALPN mismatch: a client offering none of the server\'s protocols fails the handshake (no_application_protocol); a server offering none agrees none', async () => {
    const leaf = imported(ecLeaf);
    for (const version of ['TLSv1.3', 'TLSv1.2']) {
      const s = engine.server(leaf, { alpn: ['h2', 'http/1.1'] });
      const r = await serve(s, { servername: 'server.test', ca: ecLeaf.pem, ALPNProtocols: ['spdy/3'], minVersion: version, maxVersion: version });
      assert.equal(r.ok, false, `${version}: a mismatched ALPN was served`);
      assert.match(String(r.err?.code), /NO_APPLICATION_PROTOCOL/, `${version}: ${r.err?.code} ${r.err?.message}`);
      assert.ok(r.state.error < 0, `${version}: the engine reported no error`);
      assert.equal(s.done, false);
      s.free();
      const plain = engine.server(leaf);
      const p = await serve(plain, { servername: 'server.test', ca: ecLeaf.pem, ALPNProtocols: ['spdy/3'], minVersion: version, maxVersion: version });
      assert.ok(served(p), `${version}: no ALPN on the server`);
      assert.equal(plain.alpn, '');
      plain.free();
    }
    for (const bad of [Buffer.of(0), Buffer.of(5, 0x68), Buffer.of(2, 0x68, 0x32, 0)]) {
      assert.equal(engine.with(bad, (a) => engine.m._tls_server_new(leaf, a, bad.length, 0, 0)), 0, `ALPN wire ${bad.toString('hex')}`);
      assert.equal(engine.error, BADARG);
    }
    engine.m._tls_leaf_free(leaf);
  });

  test('SNI: tls_sni gives the client\'s servername, with no requirement on it, and is empty when the client sends none', async () => {
    const leaf = imported(ecLeaf);
    for (const [servername, sni] of [['server.test', 'server.test'], ['Other.Example', 'Other.Example'], ['', '']]) {
      const s = engine.server(leaf);
      assert.equal(s.sni, '', 'none before the handshake');
      const r = await serve(s, { servername: servername || undefined, host: servername ? undefined : '127.0.0.1', ca: ecLeaf.pem, anyName: true });
      assert.ok(served(r), `${servername || 'no SNI'}: ${r.err?.code}`);
      assert.equal(s.sni, sni);
      assert.equal(engine.m._tls_sni(s.ptr, engine.scratch, 2), sni.length > 2 ? BADARG : sni.length, 'a buffer too small');
      s.free();
    }
    engine.m._tls_leaf_free(leaf);
  });

  for (const version of ['TLSv1.3', 'TLSv1.2']) {
    test(`client certificates over ${version}: REQUIRE_CERT refuses a client without one, one from another CA and a serverAuth-only one, and passes one from client_ca (tls_peer_der gives it); REQUEST_CERT passes without one`, async () => {
      const leaf = imported(ecLeaf);
      const good = clientCert();
      const stranger = clientCert(makeCa('homescoop tls-engine stranger CA'), 'stranger.test');
      const serverOnly = clientCert(clientCa, 'server-only.test', '1.3.6.1.5.5.7.3.1');
      const base = { servername: 'server.test', ca: ecLeaf.pem, minVersion: version, maxVersion: version };
      const run = async (flags, opts) => {
        const s = engine.server(leaf, { ca: clientStore, flags });
        assert.ok(s, engine.strerror(engine.error));
        const r = await serve(s, { ...base, ...opts });
        return { s, r };
      };
      const required = await run(REQUIRE_CERT, { cert: good.cert, key: good.key });
      assert.ok(served(required.r), `REQUIRE_CERT with a client_ca cert: ${required.r.err?.code} ${engine.strerror(required.r.state.error ?? 0)}`);
      assert.equal(required.s.verify, 0);
      assert.equal(required.s.peers.length, 1);
      assert.deepEqual(required.s.peers[0], Buffer.from(good.der));
      required.s.free();
      for (const [label, opts] of [['no certificate', {}], ['a certificate from another CA', { cert: stranger.cert, key: stranger.key }], ['a serverAuth-only certificate from client_ca', { cert: serverOnly.cert, key: serverOnly.key }]]) {
        const { s, r } = await run(REQUIRE_CERT, opts);
        assert.equal(served(r), false, `REQUIRE_CERT with ${label} was served`);
        assert.ok(r.state.error < 0, `REQUIRE_CERT with ${label}: the engine reported no error`);
        assert.equal(s.done, false, `REQUIRE_CERT with ${label}: the handshake finished`);
        s.free();
      }
      const bare = await run(REQUEST_CERT, {});
      assert.ok(served(bare.r), `REQUEST_CERT without a certificate: ${bare.r.err?.code}`);
      assert.equal(bare.s.peers.length, 0);
      bare.s.free();
      const offered = await run(REQUEST_CERT, { cert: good.cert, key: good.key });
      assert.ok(served(offered.r));
      assert.equal(offered.s.verify, 0);
      assert.deepEqual(offered.s.peers[0], Buffer.from(good.der));
      offered.s.free();
      const untrusted = await run(REQUEST_CERT, { cert: stranger.cert, key: stranger.key });
      assert.ok(served(untrusted.r), 'REQUEST_CERT leaves an untrusted certificate to the caller');
      assert.ok(untrusted.s.verify & NOT_TRUSTED, `tls_verify_result ${untrusted.s.verify}`);
      untrusted.s.free();
      const unasked = engine.server(leaf);
      const u = await serve(unasked, { ...base, cert: good.cert, key: good.key });
      assert.ok(served(u));
      assert.equal(unasked.peers.length, 0, 'no client certificate asked for without flags');
      unasked.free();
      engine.m._tls_leaf_free(leaf);
    });
  }

  test('refused: flags other than 0, REQUEST_CERT and REQUIRE_CERT, a flag without client_ca, a leaf without a chain; tls_client_cert on a server session', () => {
    const leaf = imported(ecLeaf);
    for (const [flags, ca] of [[3, clientStore], [4, clientStore], [-1, clientStore], [REQUEST_CERT, 0], [REQUIRE_CERT, 0]]) {
      assert.equal(engine.m._tls_server_new(leaf, 0, 0, ca, flags), 0, `flags ${flags} ca ${ca}`);
      assert.equal(engine.error, BADARG);
    }
    const bare = engine.m._tls_leaf_new();
    assert.equal(engine.m._tls_server_new(bare, 0, 0, 0, 0), 0, 'a leaf without a chain');
    assert.equal(engine.error, BADARG);
    assert.equal(engine.m._tls_server_new(0, 0, 0, 0, 0), 0, 'no leaf');
    engine.m._tls_leaf_free(bare);
    const s = engine.server(leaf, { ca: clientStore });
    assert.ok(s, 'client_ca with flags 0 is a session that asks for nothing');
    const good = clientCert();
    const k = keyBytes(good.key);
    assert.equal(engine.with(good.der, (c) => engine.with(k, (kp) => engine.m._tls_client_cert(s.ptr, c, good.der.length, kp, k.length, 0, 0))), BADARG);
    s.free();
    engine.m._tls_leaf_free(leaf);
  });

  test('the MITM path is unchanged: tls_session_new still requires the SNI to name its host, and tls_sni gives it', async () => {
    const ca = makeCa('homescoop tls-engine mitm CA');
    const leaf = engine.m._tls_leaf_new();
    const spki = engine.into((p, max) => engine.m._tls_leaf_spki(leaf, p, max));
    const der = ca.issue('mitm.test', spki);
    assert.equal(engine.with(der, (p) => engine.m._tls_leaf_add_cert(leaf, p, der.length)), 0);
    const open = (host) => new Session(engine, engine.with(Buffer.from(host), (p) => engine.m._tls_session_new(leaf, p)));
    const s = open('mitm.test');
    const r = await serve(s, { servername: 'mitm.test', ca: ca.pem, ALPNProtocols: ['h2', 'http/1.1'] });
    assert.ok(served(r));
    assert.equal(r.alpn, 'http/1.1');
    assert.equal(s.sni, 'mitm.test');
    s.free();
    const evil = open('mitm.test');
    const e = await serve(evil, { servername: 'evil.test', ca: ca.pem });
    assert.equal(served(e), false, 'another host\'s SNI');
    evil.free();
    engine.m._tls_leaf_free(leaf);
  });
});
