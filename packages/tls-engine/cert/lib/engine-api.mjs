import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { makeCa } from './x509.mjs';

const EOF = -1;
const BADARG = -3;
const SCRATCH = 64 * 1024;
const IN_CAP = 40 * 1024;
const OUT_CAP = 64 * 1024;

// The module's exports, as index.d.ts declares them (what slicc imports).
const EXPORTS = [
  '_malloc', '_free', '_tls_last_error', '_tls_strerror', '_tls_leaf_new', '_tls_leaf_spki',
  '_tls_leaf_add_cert', '_tls_leaf_free', '_tls_session_new', '_tls_feed', '_tls_feed_eof',
  '_tls_in_room', '_tls_read', '_tls_write', '_tls_handshake_done', '_tls_out_size',
  '_tls_out_take', '_tls_close', '_tls_version', '_tls_alpn_http11', '_tls_session_free',
];

let work;
function packageDir() {
  if (process.env.TLS_ENGINE_PACKAGE) return resolve(process.env.TLS_ENGINE_PACKAGE);
  const tgz = resolve(process.env.TLS_ENGINE_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'tls-engine-cert-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

/** The engine behind a small typed API, as slicc's tls-engine.ts has it. */
class Engine {
  constructor(m) {
    this.m = m;
    this.scratch = m._malloc(SCRATCH);
  }
  put(bytes) {
    const ptr = this.m._malloc(bytes.length + 1);
    this.m.HEAPU8.set(bytes, ptr);
    this.m.HEAPU8[ptr + bytes.length] = 0;
    return ptr;
  }
  with(bytes, fn) {
    const ptr = this.put(bytes);
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
  strerror(code) {
    this.m._tls_strerror(code, this.scratch, 256);
    const end = this.m.HEAPU8.indexOf(0, this.scratch);
    return new TextDecoder().decode(this.m.HEAPU8.subarray(this.scratch, end));
  }
  leaf() {
    const ptr = this.m._tls_leaf_new();
    assert.ok(ptr, `tls_leaf_new: ${this.strerror(this.m._tls_last_error())}`);
    const e = this;
    return {
      ptr,
      spki: () => {
        const out = e.into((p, max) => e.m._tls_leaf_spki(ptr, p, max));
        assert.ok(out instanceof Uint8Array, `tls_leaf_spki: ${out}`);
        return out;
      },
      addCert: (der) => e.with(der, (p) => e.m._tls_leaf_add_cert(ptr, p, der.length)),
      release: () => e.m._tls_leaf_free(ptr),
    };
  }
  session(leaf, host) {
    const ptr = this.with(new TextEncoder().encode(host), (p) => this.m._tls_session_new(leaf.ptr, p));
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
    return out; // an error code
  }
  write(bytes) {
    return this.e.with(bytes, (p) => this.m._tls_write(this.ptr, p, bytes.length));
  }
  take() {
    if (this.m._tls_out_size(this.ptr) === 0) return null;
    const out = this.e.into((p, max) => this.m._tls_out_take(this.ptr, p, max));
    return out instanceof Uint8Array ? out : null;
  }
  get version() {
    return this.m._tls_version(this.ptr);
  }
  get alpnHttp11() {
    return this.m._tls_alpn_http11(this.ptr) === 1;
  }
  get handshakeDone() {
    return this.m._tls_handshake_done(this.ptr) !== 0;
  }
  free() {
    this.m._tls_session_free(this.ptr);
  }
}

/**
 * One tunnel: a Duplex that is the client's socket. Ciphertext the client
 * writes is fed to the session (in pieces, as room allows); plaintext the
 * session yields goes to `app.data(bytes, reply)`; whatever the session
 * makes is drained back to the client after every call.
 */
function tunnel(session, app = {}) {
  let pending = Buffer.alloc(0);
  let ended = false;
  const state = { error: null, eof: false, maxFed: 0, writesThatWaited: 0 };
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
  const reply = (bytes) => {
    for (let at = 0; at < bytes.length; ) {
      const n = session.write(bytes.subarray(at, at + 16 * 1024));
      assert.ok(n >= 0, `tls_write: ${n}`);
      if (n === 0) state.writesThatWaited++;
      flush();
      at += n;
    }
  };
  const close = () => {
    session.m._tls_close(session.ptr);
    flush();
    wire.push(null);
  };
  function pump() {
    for (;;) {
      if (pending.length) {
        const n = session.feed(pending);
        state.maxFed = Math.max(state.maxFed, n);
        pending = pending.subarray(n);
      }
      const got = session.read();
      flush();
      if (got instanceof Uint8Array) {
        app.data?.(Buffer.from(got), reply, close);
        continue;
      }
      if (got === 'eof') {
        state.eof = true;
        app.eof?.();
        wire.push(null);
        return;
      }
      if (typeof got === 'number') {
        state.error = got;
        app.error?.(got);
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

function client(wire, ca, opts = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({
      socket: wire,
      servername: opts.servername,
      ca: opts.ca ?? ca.pem,
      ALPNProtocols: ['h2', 'http/1.1'],
      minVersion: opts.minVersion,
      maxVersion: opts.maxVersion,
    });
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Write `request`, read until `done(buffer)` (or the end). */
function exchange(socket, request, done) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onData = (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (done(all)) {
        socket.off('data', onData);
        resolve(all);
      }
    };
    socket.on('data', onData);
    socket.once('end', () => resolve(Buffer.concat(chunks)));
    socket.once('error', reject);
    socket.write(request);
  });
}

let engine;
let ca;
let createTlsEngine;
let wasm;

before(async () => {
  const dir = packageDir();
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  console.log(`engine-api: ${manifest.name}@${manifest.version} from ${dir}`);
  ({ default: createTlsEngine } = await import(pathToFileURL(join(dir, 'dist/slicc-tls-engine.mjs')).href));
  wasm = readFileSync(join(dir, 'dist/slicc-tls-engine.wasm'));
  engine = new Engine(await createTlsEngine({ wasmBinary: wasm }));
  ca = makeCa();
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

/** A leaf for `host`, its chain the leaf then the CA, as the realm proxy builds it. */
function leafFor(host, opts) {
  const leaf = engine.leaf();
  assert.equal(leaf.addCert(ca.issue(host, leaf.spki(), opts)), 0, 'the leaf certificate');
  assert.equal(leaf.addCert(ca.der), 0, 'the CA certificate');
  return leaf;
}

describe('import', () => {
  test('the factory instantiates from wasmBinary and has every export index.d.ts names', async () => {
    assert.equal(typeof createTlsEngine, 'function');
    const m = await createTlsEngine({ wasmBinary: wasm });
    assert.ok(m.HEAPU8 instanceof Uint8Array);
    for (const name of EXPORTS) assert.equal(typeof m[name], 'function', name);
  });

  test('no entropy is an error, not a JS throw, and a fresh instance recovers (#551)', async () => {
    const m = await createTlsEngine({ wasmBinary: wasm });
    const fresh = new Engine(m);
    const real = globalThis.crypto.getRandomValues;
    globalThis.crypto.getRandomValues = () => {
      throw new Error('no entropy');
    };
    let ptr;
    try {
      ptr = m._tls_leaf_new();
    } finally {
      globalThis.crypto.getRandomValues = real;
    }
    assert.equal(ptr, 0, 'a leaf without entropy');
    assert.equal(fresh.strerror(m._tls_last_error()), 'PSA - Insufficient entropy');
    const leaf = fresh.leaf();
    assert.equal(leaf.addCert(ca.issue('again.test', leaf.spki())), 0);
    const session = fresh.session(leaf, 'again.test');
    leaf.release();
    const { wire } = tunnel(session, { data: (b, reply) => reply(Buffer.from('recovered')) });
    const socket = await client(wire, ca, { servername: 'again.test' });
    assert.equal((await exchange(socket, 'x', (b) => b.length >= 9)).toString(), 'recovered');
    socket.destroy();
    session.free();
  });

  test('a leaf is a P-256 key pair; only its SubjectPublicKeyInfo leaves the engine', () => {
    const leaf = engine.leaf();
    const spki = leaf.spki();
    const key = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
    assert.equal(key.asymmetricKeyType, 'ec');
    assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
    assert.notDeepEqual(Buffer.from(engine.leaf().spki()), Buffer.from(spki), 'two leaves, one key');
    leaf.release();
  });
});

describe('handshake and round trip', () => {
  for (const [name, wire] of [['TLSv1.3', 0x0304], ['TLSv1.2', 0x0303]]) {
    test(`${name}: verified against the CA as the session's host, http/1.1 by ALPN, data both ways`, async () => {
      const leaf = leafFor('example.test');
      const session = engine.session(leaf, 'example.test');
      leaf.release(); // the session keeps it
      assert.ok(session);
      assert.equal(session.handshakeDone, false);
      const { wire: w } = tunnel(session, {
        data: (bytes, reply) => reply(Buffer.from(`echo ${bytes.length}: ${bytes}`)),
      });
      const socket = await client(w, ca, { servername: 'example.test', minVersion: name, maxVersion: name });
      assert.equal(socket.authorized, true);
      assert.equal(socket.getProtocol(), name);
      assert.equal(socket.alpnProtocol, 'http/1.1');
      const peer = socket.getPeerX509Certificate();
      assert.equal(peer.subjectAltName, 'DNS:example.test');
      assert.equal(peer.checkIssued(new X509Certificate(ca.pem)), true);
      const res = await exchange(socket, 'GET / HTTP/1.1\r\n\r\n', (b) => b.includes('\r\n\r\n'));
      assert.equal(res.toString(), 'echo 18: GET / HTTP/1.1\r\n\r\n');
      // The server's side is done once it has read the client's Finished.
      assert.equal(session.handshakeDone, true);
      assert.equal(session.version, wire);
      assert.equal(session.alpnHttp11, true);
      socket.destroy();
      session.free();
    });
  }

  test('the whole chain goes out: a client that trusts only the root accepts a leaf from an intermediate', async () => {
    const root = makeCa('homescoop tls-engine cert root', { pathLen: 1 });
    const intermediate = makeCa('homescoop tls-engine cert intermediate', { parent: root });
    const leaf = engine.leaf();
    assert.equal(leaf.addCert(intermediate.issue('chain.test', leaf.spki())), 0, 'the leaf certificate');
    const session = engine.session(leaf, 'chain.test');
    leaf.release();
    // Without the intermediate in the chain, the root alone can't verify the leaf.
    const short = tunnel(session);
    await assert.rejects(client(short.wire, root, { servername: 'chain.test' }), (err) => {
      assert.match(err.code, /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
      return true;
    });
    session.free();
    const full = engine.leaf();
    assert.equal(full.addCert(intermediate.issue('chain.test', full.spki())), 0);
    assert.equal(full.addCert(intermediate.der), 0, 'the intermediate');
    assert.equal(full.addCert(root.der), 0, 'the root');
    const s2 = engine.session(full, 'chain.test');
    full.release();
    const { wire } = tunnel(s2, { data: (b, reply) => reply(Buffer.from('chained')) });
    const socket = await client(wire, root, { servername: 'chain.test' });
    assert.equal(socket.authorized, true);
    assert.equal(socket.getPeerX509Certificate().checkIssued(new X509Certificate(intermediate.pem)), true);
    assert.equal((await exchange(socket, 'x', (b) => b.length >= 7)).toString(), 'chained');
    socket.destroy();
    s2.free();
  });

  test('an IP literal (no SNI) is served with an iPAddress leaf', async () => {
    const leaf = leafFor('203.0.113.7');
    const session = engine.session(leaf, '203.0.113.7');
    leaf.release();
    const { wire } = tunnel(session, { data: (b, reply) => reply(Buffer.from('by address')) });
    const socket = await new Promise((resolve, reject) => {
      const s = connect({ socket: wire, host: '203.0.113.7', ca: ca.pem });
      s.once('secureConnect', () => resolve(s));
      s.once('error', reject);
    });
    assert.equal(socket.authorized, true);
    assert.equal((await exchange(socket, 'x', (b) => b.length >= 10)).toString(), 'by address');
    socket.destroy();
    session.free();
  });

  for (const name of ['TLSv1.3', 'TLSv1.2']) {
    test(`${name}: 1 MiB up and 1 MiB down, more than the engine's buffers, intact`, async () => {
      const up = Buffer.alloc(1 << 20);
      for (let i = 0; i < up.length; i++) up[i] = (i * 7 + (i >> 9)) & 0xff;
      const down = Buffer.alloc(1 << 20);
      for (let i = 0; i < down.length; i++) down[i] = (i * 13 + 5) & 0xff;
      const leaf = leafFor('big.test');
      const session = engine.session(leaf, 'big.test');
      leaf.release();
      const hash = createHash('sha256');
      let got = 0;
      const { wire, state } = tunnel(session, {
        data: (bytes, reply) => {
          hash.update(bytes);
          got += bytes.length;
          if (got === up.length) reply(Buffer.concat([Buffer.from(`${hash.digest('hex')}\n`), down]));
        },
      });
      const socket = await client(wire, ca, { servername: 'big.test', minVersion: name, maxVersion: name });
      const res = await exchange(socket, up, (b) => b.length >= 65 + down.length);
      assert.equal(res.subarray(0, 65).toString(), `${createHash('sha256').update(up).digest('hex')}\n`, 'upload');
      assert.equal(createHash('sha256').update(res.subarray(65)).digest('hex'), createHash('sha256').update(down).digest('hex'), 'download');
      assert.ok(state.maxFed <= IN_CAP, `fed ${state.maxFed} > ${IN_CAP}`);
      socket.destroy();
      session.free();
    });
  }

  test('several requests on one session, then close_notify both ways', async () => {
    const leaf = leafFor('keep.test');
    const session = engine.session(leaf, 'keep.test');
    leaf.release();
    let n = 0;
    const { wire, state } = tunnel(session, {
      data: (bytes, reply, close) => {
        if (bytes.toString() === 'bye') close();
        else reply(Buffer.from(`#${++n} ${bytes}`));
      },
    });
    const socket = await client(wire, ca, { servername: 'keep.test' });
    for (let i = 1; i <= 3; i++) {
      assert.equal((await exchange(socket, `req${i}`, (b) => b.length >= 7)).toString(), `#${i} req${i}`);
    }
    // The engine's close_notify ends the client's side.
    const ended = new Promise((resolve) => socket.once('end', resolve));
    socket.write('bye');
    await ended;
    socket.end();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.error, null);
    socket.destroy();
    session.free();
  });

  test('a client that ends its side gives tls_read the end of stream', async () => {
    const leaf = leafFor('eof.test');
    const session = engine.session(leaf, 'eof.test');
    leaf.release();
    const { wire, state } = tunnel(session, { data: (b, reply) => reply(b) });
    const socket = await client(wire, ca, { servername: 'eof.test' });
    assert.equal((await exchange(socket, 'ping', (b) => b.length >= 4)).toString(), 'ping');
    socket.end();
    for (let i = 0; i < 100 && !state.eof; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(state.eof, true, `no end of stream (error ${state.error})`);
    socket.destroy();
    session.free();
  });

  test('300 leaves alive at once (the realm proxy keeps 256), each serving its host', async () => {
    const leaves = [];
    for (let i = 0; i < 300; i++) leaves.push(leafFor(`h${i}.test`));
    for (const i of [0, 150, 299]) {
      const session = engine.session(leaves[i], `h${i}.test`);
      assert.ok(session, `session ${i}: ${engine.strerror(engine.m._tls_last_error())}`);
      const { wire } = tunnel(session, { data: (b, reply) => reply(Buffer.from(`h${i}`)) });
      const socket = await client(wire, ca, { servername: `h${i}.test`, maxVersion: i % 2 ? 'TLSv1.2' : 'TLSv1.3' });
      assert.equal((await exchange(socket, 'x', (b) => b.length >= 2)).toString(), `h${i}`);
      socket.destroy();
      session.free();
    }
    for (const leaf of leaves) leaf.release();
  });

  test('leaves and sessions are freed: 1500 more cycles do not grow the heap', async () => {
    const cycle = () => {
      const leaf = leafFor('cycle.test');
      const session = engine.session(leaf, 'cycle.test');
      leaf.release();
      session.free();
    };
    for (let i = 0; i < 100; i++) cycle();
    const before = engine.m.HEAPU8.length;
    for (let i = 0; i < 1500; i++) cycle();
    assert.equal(engine.m.HEAPU8.length, before, `heap grew from ${before} to ${engine.m.HEAPU8.length}`);
  });
});

describe('refusals', () => {
  test('a leaf certificate for another key is refused, and a leaf without one has no session', () => {
    const leaf = engine.leaf();
    const other = engine.leaf();
    const wrong = leaf.addCert(ca.issue('wrong.test', other.spki()));
    assert.ok(wrong < 0, `the other key's certificate was taken (${wrong})`);
    const text = engine.strerror(wrong);
    console.log(`engine-api: wrong leaf: ${wrong} ${text}`);
    assert.doesNotMatch(text, /UNKNOWN ERROR CODE/, `tls_strerror does not name ${wrong}: ${text}`);
    assert.equal(engine.session(leaf, 'wrong.test'), null, 'a session without a chain');
    assert.equal(engine.m._tls_last_error(), BADARG);
    // The CA's own certificate is not the leaf's either, and garbage is no certificate.
    const fresh = engine.leaf();
    assert.ok(fresh.addCert(ca.der) < 0, 'the CA certificate was taken as the leaf');
    const garbage = engine.leaf();
    const bad = garbage.addCert(Buffer.from('not a certificate'));
    assert.ok(bad < 0, 'garbage was taken');
    assert.match(engine.strerror(bad), /^X509 - /);
    for (const l of [leaf, other, fresh, garbage]) l.release();
  });

  test('a ClientHello whose SNI names another host is refused', async () => {
    const leaf = leafFor('example.test');
    const session = engine.session(leaf, 'example.test');
    leaf.release();
    const { wire, state } = tunnel(session);
    await assert.rejects(client(wire, ca, { servername: 'evil.test' }), /alert|handshake|unrecognized_name|ECONNRESET|socket/i);
    assert.ok(state.error < 0, 'the engine reported no error');
    assert.equal(session.handshakeDone, false);
    session.free();
  });

  test('a client that does not trust the CA refuses the chain', async () => {
    const leaf = leafFor('example.test');
    const session = engine.session(leaf, 'example.test');
    leaf.release();
    const { wire } = tunnel(session);
    await assert.rejects(client(wire, ca, { servername: 'example.test', ca: makeCa('another CA').pem }), (err) => {
      assert.match(err.code, /UNABLE_TO_GET_ISSUER_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
      return true;
    });
    session.free();
  });

  test('an expired leaf is refused by the client', async () => {
    const leaf = leafFor('old.test', { notBefore: new Date(Date.now() - 10 * 86400_000), notAfter: new Date(Date.now() - 86400_000) });
    const session = engine.session(leaf, 'old.test');
    leaf.release();
    const { wire } = tunnel(session);
    await assert.rejects(client(wire, ca, { servername: 'old.test' }), (err) => {
      assert.equal(err.code, 'CERT_HAS_EXPIRED');
      return true;
    });
    session.free();
  });

  test('plaintext where a ClientHello should be is an error, not a hang', () => {
    const leaf = leafFor('plain.test');
    const session = engine.session(leaf, 'plain.test');
    leaf.release();
    const plain = Buffer.from('GET / HTTP/1.1\r\nHost: plain.test\r\n\r\n');
    assert.equal(session.feed(plain), plain.length);
    const r = session.read();
    assert.ok(typeof r === 'number' && r < EOF, `tls_read gave ${r}`);
    console.log(`engine-api: plaintext: ${r} ${engine.strerror(r)}`);
    assert.match(engine.strerror(r), /^SSL - /);
    session.free();
  });

  test('tls_feed takes no more than the room it has', () => {
    const leaf = leafFor('room.test');
    const session = engine.session(leaf, 'room.test');
    leaf.release();
    assert.equal(session.m._tls_in_room(session.ptr), IN_CAP);
    assert.equal(session.feed(Buffer.alloc(IN_CAP + 100, 0x16)), IN_CAP);
    assert.equal(session.m._tls_in_room(session.ptr), 0);
    assert.equal(session.feed(Buffer.alloc(10)), 0);
    session.free();
    assert.ok(OUT_CAP > IN_CAP);
  });
});
