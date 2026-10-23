import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { TLSSocket, connect, createSecureContext } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { selfSigned } from './x509.mjs';

const SCRATCH = 64 * 1024;
const EOF = -1;
const BADARG = -3;
const SELECT_PENDING = -4;
const REQUEST_CERT = 1;
const SELECT = 4;
const KEYLOG = 8;
const CLIENT = { INSECURE: 1, NO_SNI: 2, CHAIN_ONLY: 4 };
const TLS13 = ['CLIENT_HANDSHAKE_TRAFFIC_SECRET', 'SERVER_HANDSHAKE_TRAFFIC_SECRET', 'CLIENT_TRAFFIC_SECRET_0', 'SERVER_TRAFFIC_SECRET_0', 'EXPORTER_SECRET'];
const TLS12 = ['CLIENT_RANDOM'];
const LINE = /^([A-Z_0-9]+) ([0-9a-f]{64}) ([0-9a-f]{64}|[0-9a-f]{96})$/;

let work;
function packageDir() {
  if (process.env.TLS_ENGINE_PACKAGE) return resolve(process.env.TLS_ENGINE_PACKAGE);
  const tgz = resolve(process.env.TLS_ENGINE_TGZ || '.homescoop-out/package.tgz');
  work = mkdtempSync(join(tmpdir(), 'tls-engine-keylog-'));
  const r = spawnSync('tar', ['-xzf', tgz, '-C', work], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -xzf ${tgz}: ${r.stderr}`);
  return join(work, 'package');
}

let m;
let scratch;
let cert;
let leaf;
let store;
let dir;

function withBytes(bytes, fn) {
  const ptr = m._malloc(bytes.length + 1);
  m.HEAPU8.set(bytes, ptr);
  m.HEAPU8[ptr + bytes.length] = 0;
  try {
    return fn(ptr);
  } finally {
    m.HEAPU8.fill(0, ptr, ptr + bytes.length + 1);
    m._free(ptr);
  }
}

function strerror(code) {
  m._tls_strerror(code, scratch, 256);
  return new TextDecoder().decode(m.HEAPU8.subarray(scratch, m.HEAPU8.indexOf(0, scratch)));
}

function serverSession(flags = KEYLOG, { useLeaf = leaf, ca = 0 } = {}) {
  const ptr = m._tls_server_new(useLeaf, 0, 0, ca, flags);
  assert.ok(ptr, `tls_server_new(${flags}): ${strerror(m._tls_last_error())}`);
  return ptr;
}

function clientSession(flags = KEYLOG, name = 'server.test') {
  const ptr = withBytes(Buffer.from(name), (n) => m._tls_client_new_name(store, n, name.length, 0, 0, flags));
  assert.ok(ptr, `tls_client_new_name(${flags}): ${strerror(m._tls_last_error())}`);
  return ptr;
}

function drain(s, max = SCRATCH) {
  const n = m._tls_keylog(s, scratch, max);
  if (n <= 0) return n;
  const text = new TextDecoder().decode(m.HEAPU8.subarray(scratch, scratch + n));
  m.HEAPU8.fill(0, scratch, scratch + n);
  return text;
}

function lines(text) {
  return text.split('\n').filter((l) => l && !l.startsWith('#'));
}

function drainLines(s) {
  const text = drain(s);
  if (text === 0) return [];
  assert.equal(typeof text, 'string', `tls_keylog: ${text}`);
  assert.ok(text.endsWith('\n'), 'every line ends with \\n');
  return lines(text);
}

function heapHas(needles) {
  const heap = Buffer.from(m.HEAPU8.buffer, m.HEAPU8.byteOffset, m.HEAPU8.byteLength);
  return needles.filter((n) => heap.indexOf(n, 0, 'latin1') !== -1);
}

const secrets = (ls) => ls.map((l) => l.split(' ')[2]);

function checkShape(ls, labels) {
  for (const l of ls) assert.match(l, LINE, l);
  assert.deepEqual(ls.map((l) => l.split(' ')[0]).sort(), [...labels].sort(), 'one line per secret');
  assert.equal(new Set(ls.map((l) => l.split(' ')[1])).size, 1, 'one client random');
}

function agree(engineLines, peerLines, labels) {
  checkShape(engineLines, labels);
  assert.deepEqual([...engineLines].sort(), [...peerLines].sort(), `engine:\n${engineLines.join('\n')}\npeer:\n${peerLines.join('\n')}`);
}

function attach(s, { greet, onSelect, keylog = true } = {}) {
  let pending = Buffer.alloc(0);
  let ended = false;
  const state = { error: null, eof: false, got: '', done: false, lines: [] };
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
    for (let n = m._tls_out_size(s); n > 0; n = m._tls_out_size(s)) {
      const k = m._tls_out_take(s, scratch, SCRATCH);
      wire.push(Buffer.from(m.HEAPU8.slice(scratch, scratch + k)));
    }
  };
  const collect = () => {
    if (keylog) state.lines.push(...drainLines(s));
  };
  function stop(error) {
    if (error === undefined) state.eof = true;
    else state.error = error;
    collect();
    wire.push(null);
  }
  function pump() {
    for (let spins = 0; spins < 10000; spins++) {
      if (state.error !== null || state.eof) return;
      if (pending.length) pending = pending.subarray(withBytes(pending, (p) => m._tls_feed(s, p, pending.length)));
      if (!state.done) {
        const h = m._tls_handshake(s);
        collect();
        flush();
        if (h === 2 && onSelect) {
          onSelect(s);
          onSelect = null;
          continue;
        }
        if (h < 0) return stop(h);
        if (h === 1) {
          state.done = true;
          if (greet) {
            const n = withBytes(Buffer.from(greet), (p) => m._tls_write(s, p, greet.length));
            assert.equal(n, greet.length);
            flush();
          }
          continue;
        }
      } else {
        const n = m._tls_read(s, scratch, SCRATCH);
        collect();
        flush();
        if (n > 0) {
          const bytes = Buffer.from(m.HEAPU8.slice(scratch, scratch + n));
          state.got += bytes.toString();
          if (!greet) withBytes(bytes, (p) => m._tls_write(s, p, bytes.length));
          flush();
          continue;
        }
        if (n === EOF) return stop();
        if (n < 0 && n !== SELECT_PENDING) return stop(n);
      }
      if (pending.length) continue;
      if (ended) {
        m._tls_feed_eof(s);
        ended = false;
        continue;
      }
      return;
    }
  }
  return { wire, state, pump };
}

function openssl(args, input) {
  return new Promise((done) => {
    const child = execFile('openssl', args, { timeout: 20_000, encoding: 'utf8' }, (err, stdout, stderr) => done({ err, out: `${stdout}\n${stderr}` }));
    child.stdin.end(input);
  });
}

async function sClient(makeSession, version, { onSelect } = {}) {
  const sessions = [];
  const sockets = new Set();
  const srv = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    const s = makeSession();
    const a = attach(s, { onSelect });
    sessions.push({ s, state: a.state });
    socket.pipe(a.wire);
    a.wire.pipe(socket);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const file = join(dir, `s_client-${version}-${Date.now()}.keylog`);
  const caFile = join(dir, 'ca.pem');
  try {
    const r = await openssl(['s_client', '-connect', `127.0.0.1:${srv.address().port}`, '-servername', 'server.test', '-CAfile', caFile, '-verify_return_error', version === 'TLSv1.3' ? '-tls1_3' : '-tls1_2', '-keylogfile', file, '-quiet', '-no_ign_eof'], 'ping\n');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sessions.length, 1, r.out);
    const [{ s, state }] = sessions;
    assert.equal(m._tls_handshake_done(s), 1, `the handshake: ${state.error} ${r.out}`);
    state.lines.push(...drainLines(s));
    return { engine: state.lines, peer: lines(readFileSync(file, 'utf8')), out: r.out, s, state };
  } finally {
    for (const sock of sockets) sock.destroy();
    await new Promise((r) => srv.close(r));
    for (const { s } of sessions) m._tls_session_free(s);
    rmSync(file, { force: true });
  }
}

function nodeServer(s, version, { keylog = true, ciphers } = {}) {
  const a = attach(s, { greet: 'ping', keylog });
  const peer = [];
  const socket = new TLSSocket(a.wire, { isServer: true, secureContext: createSecureContext({ cert: cert.pem, key: cert.key.export({ type: 'pkcs8', format: 'pem' }), minVersion: version, maxVersion: version, ...(ciphers ? { ciphers } : {}) }) });
  socket.on('keylog', (line) => peer.push(line.toString().trim()));
  socket.on('data', (d) => socket.write(d));
  socket.on('error', () => {});
  a.pump();
  return new Promise((done) => {
    const check = () => {
      if (a.state.got === 'ping' || a.state.error !== null || a.state.eof) {
        a.state.lines.push(...(keylog ? drainLines(s) : []));
        socket.destroy();
        done({ engine: a.state.lines, peer, state: a.state });
      } else setTimeout(check, 5);
    };
    check();
  });
}

function nodeClient(s, version, { onSelect, ciphers } = {}) {
  const a = attach(s, { onSelect });
  const peer = [];
  const socket = connect({ socket: a.wire, servername: 'server.test', ca: cert.pem, minVersion: version, maxVersion: version, ...(ciphers ? { ciphers } : {}) });
  socket.on('keylog', (line) => peer.push(line.toString().trim()));
  return new Promise((done) => {
    socket.once('secureConnect', () => socket.write('ping'));
    socket.on('data', () => {
      a.state.lines.push(...drainLines(s));
      socket.destroy();
      done({ engine: a.state.lines, peer, state: a.state });
    });
    socket.once('error', (err) => done({ err, engine: a.state.lines, peer, state: a.state }));
  });
}

function converse(client, server) {
  const got = { client: [], server: [] };
  let clientDone = false;
  for (let round = 0; round < 64 && !(clientDone && m._tls_handshake_done(server)); round++) {
    if (!clientDone) {
      const h = m._tls_handshake(client);
      assert.ok(h >= 0, `client: ${h} ${strerror(h)}`);
      clientDone = h === 1;
    }
    got.client.push(...drainLines(client));
    for (let n = m._tls_out_size(client); n > 0; n = m._tls_out_size(client)) {
      const k = m._tls_out_take(client, scratch, SCRATCH);
      const bytes = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
      withBytes(bytes, (p) => m._tls_feed(server, p, bytes.length));
    }
    const h = m._tls_handshake(server);
    assert.ok(h >= 0, `server: ${h} ${strerror(h)}`);
    got.server.push(...drainLines(server));
    for (let n = m._tls_out_size(server); n > 0; n = m._tls_out_size(server)) {
      const k = m._tls_out_take(server, scratch, SCRATCH);
      const bytes = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
      withBytes(bytes, (p) => m._tls_feed(client, p, bytes.length));
    }
  }
  assert.ok(clientDone && m._tls_handshake_done(server), 'the handshake finished');
  return got;
}

before(async () => {
  const pkg = packageDir();
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  console.log(`keylog: ${manifest.name}@${manifest.version} from ${pkg}`);
  const { default: createTlsEngine } = await import(pathToFileURL(join(pkg, 'dist/slicc-tls-engine.mjs')).href);
  m = await createTlsEngine({ wasmBinary: readFileSync(join(pkg, 'dist/slicc-tls-engine.wasm')) });
  for (const name of ['_tls_keylog', '_tls_test_keylog_armed', '_tls_test_keylog_residue', '_tls_test_keylog_cap']) assert.equal(typeof m[name], 'function', `${manifest.version} has no ${name}`);
  scratch = m._malloc(SCRATCH);
  cert = selfSigned('server.test');
  const key = cert.key.export({ type: 'pkcs8', format: 'der' });
  leaf = withBytes(cert.der, (c) => withBytes(key, (k) => m._tls_leaf_import(c, cert.der.length, k, key.length, 0, 0)));
  assert.ok(leaf, strerror(m._tls_last_error()));
  store = m._tls_ca_new();
  assert.equal(withBytes(cert.der, (p) => m._tls_ca_add_der(store, p, cert.der.length)), 0);
  dir = mkdtempSync(join(tmpdir(), 'tls-engine-keylog-files-'));
  writeFileSync(join(dir, 'ca.pem'), cert.pem);
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('TLS_KEYLOG: NSS key log lines per session (homescoop#1774)', () => {
  for (const [version, labels] of [['TLSv1.3', TLS13], ['TLSv1.2', TLS12]]) {
    test(`a server session over ${version}: its lines are openssl s_client -keylogfile's for the same session`, async () => {
      const r = await sClient(() => serverSession(), version);
      assert.equal(r.state.got, 'ping\n', `the engine read s_client's data: ${r.out}`);
      agree(r.engine, r.peer, labels);
    });

    test(`a server session over ${version}: its lines are Node's keylog event's (tls.connect)`, async () => {
      const s = serverSession();
      const r = await nodeClient(s, version);
      assert.ifError(r.err);
      agree(r.engine, r.peer, labels);
      m._tls_session_free(s);
    });

    test(`a client session over ${version}: its lines are a Node server's keylog event's`, async () => {
      const s = clientSession();
      const r = await nodeServer(s, version);
      assert.equal(r.state.got, 'ping', `the session: ${r.state.error}`);
      agree(r.engine, r.peer, labels);
      m._tls_session_free(s);
    });
  }

  test('a SELECT server session (and REQUEST_CERT) logs too: s_client over TLS 1.3 and Node over TLS 1.2', async () => {
    const onSelect = (s) => assert.equal(m._tls_server_select(s, leaf, 0, 0), 0);
    const r = await sClient(() => serverSession(SELECT | KEYLOG, { useLeaf: 0 }), 'TLSv1.3', { onSelect });
    agree(r.engine, r.peer, TLS13);
    const s = serverSession(REQUEST_CERT | KEYLOG, { ca: store });
    const n = await nodeClient(s, 'TLSv1.2');
    assert.ifError(n.err);
    agree(n.engine, n.peer, TLS12);
    m._tls_session_free(s);
  });

  test('an engine client and an engine server, both with TLS_KEYLOG, log the same lines', () => {
    const got = converse(clientSession(), serverSession());
    checkShape(got.client, TLS13);
    assert.deepEqual([...got.client].sort(), [...got.server].sort());
  });

  test('without the flag nothing is collected: no export callback, an empty buffer, tls_keylog 0, and no secret in the heap', async () => {
    const sessions = [
      ['tls_server_new', serverSession(0)],
      ['tls_server_new SELECT', serverSession(SELECT, { useLeaf: 0 })],
      ['tls_client_new', clientSession(0)],
      ['tls_client_new INSECURE|NO_SNI', clientSession(CLIENT.INSECURE | CLIENT.NO_SNI)],
    ];
    sessions.push(['tls_session_new', withBytes(Buffer.from('server.test'), (h) => m._tls_session_new(leaf, h))]);
    for (const [label, s] of sessions) {
      assert.ok(s, label);
      assert.equal(m._tls_test_keylog_armed(s), 0, `${label}: no export callback`);
      assert.equal(m._tls_test_keylog_residue(s), 0, `${label}: an empty buffer`);
      assert.equal(m._tls_keylog(s, scratch, SCRATCH), 0, label);
      assert.equal(m._tls_test_keylog_cap(s, 100), BADARG, `${label}: no cap to set`);
      m._tls_session_free(s);
    }
    for (const version of ['TLSv1.3', 'TLSv1.2']) {
      const client = clientSession(0);
      const c = await nodeServer(client, version, { keylog: false });
      assert.equal(c.state.got, 'ping');
      assert.ok(c.peer.length > 0, 'Node logged the session');
      assert.equal(m._tls_test_keylog_armed(client), 0);
      assert.equal(m._tls_test_keylog_residue(client), 0, 'nothing collected after a handshake');
      assert.equal(m._tls_keylog(client, scratch, SCRATCH), 0);
      assert.deepEqual(heapHas(secrets(c.peer)), [], `${version}: a secret's hex in the engine's heap`);
      m._tls_session_free(client);
      const server = serverSession(0);
      const s = await nodeClient(server, version);
      assert.ifError(s.err);
      assert.equal(m._tls_test_keylog_armed(server), 0);
      assert.equal(m._tls_test_keylog_residue(server), 0);
      assert.deepEqual(heapHas(secrets(s.peer)), [], `${version}: a secret's hex in the engine's heap`);
      m._tls_session_free(server);
    }
  });

  test('the flag registers the callback; tls_keylog drains whole lines only, zeroes what it hands out, and the session zeroes the rest when freed', () => {
    const client = clientSession();
    const server = serverSession();
    assert.equal(m._tls_test_keylog_armed(client), 1);
    assert.equal(m._tls_test_keylog_armed(server), 1);
    assert.equal(m._tls_test_keylog_residue(client), 0, 'empty before the handshake');
    assert.equal(m._tls_keylog(client, scratch, SCRATCH), 0, 'no lines yet');
    let clientDone = false;
    for (let round = 0; round < 64 && !(clientDone && m._tls_handshake_done(server)); round++) {
      if (!clientDone) clientDone = m._tls_handshake(client) === 1;
      for (let n = m._tls_out_size(client); n > 0; n = m._tls_out_size(client)) {
        const k = m._tls_out_take(client, scratch, SCRATCH);
        const b = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
        withBytes(b, (p) => m._tls_feed(server, p, b.length));
      }
      m._tls_handshake(server);
      for (let n = m._tls_out_size(server); n > 0; n = m._tls_out_size(server)) {
        const k = m._tls_out_take(server, scratch, SCRATCH);
        const b = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
        withBytes(b, (p) => m._tls_feed(client, p, b.length));
      }
    }
    m.HEAPU8.fill(0, scratch, scratch + SCRATCH);
    const held = m._tls_test_keylog_residue(client);
    assert.ok(held > 5 * 150, `the client holds its 5 lines: ${held}`);
    assert.equal(m._tls_keylog(client, scratch, 100), BADARG, 'no room for one whole line');
    assert.equal(m._tls_test_keylog_residue(client), held, 'a refused drain keeps the lines');
    const first = drain(client, 250);
    assert.equal(lines(first).length, 1, `only whole lines: ${first}`);
    assert.ok(first.endsWith('\n'));
    const rest = drain(client);
    const clientLines = [...lines(first), ...lines(rest)];
    checkShape(clientLines, TLS13);
    assert.equal(m._tls_test_keylog_residue(client), 0, 'the buffer is zero after a drain');
    assert.equal(m._tls_keylog(client, scratch, SCRATCH), 0, 'drained: 0');
    const kept = secrets(clientLines);
    assert.deepEqual(heapHas(kept).sort(), [...kept].sort(), 'the server session still holds the same secrets, undrained');
    m._tls_session_free(server);
    assert.deepEqual(heapHas(kept), [], 'no copy left: the drain zeroed the client\'s lines and tls_session_free the server\'s');
    m._tls_session_free(client);
  });

  test('the buffer is bounded: a line that does not fit is dropped whole, never truncated', () => {
    const client = clientSession();
    const server = serverSession();
    assert.equal(m._tls_test_keylog_cap(client, 4097), BADARG, 'never above 4096');
    assert.equal(m._tls_test_keylog_cap(client, 200), 0);
    const got = { client: [], server: [] };
    let clientDone = false;
    for (let round = 0; round < 64 && !(clientDone && m._tls_handshake_done(server)); round++) {
      if (!clientDone) clientDone = m._tls_handshake(client) === 1;
      for (let n = m._tls_out_size(client); n > 0; n = m._tls_out_size(client)) {
        const k = m._tls_out_take(client, scratch, SCRATCH);
        const b = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
        withBytes(b, (p) => m._tls_feed(server, p, b.length));
      }
      m._tls_handshake(server);
      got.server.push(...drainLines(server));
      for (let n = m._tls_out_size(server); n > 0; n = m._tls_out_size(server)) {
        const k = m._tls_out_take(server, scratch, SCRATCH);
        const b = Buffer.from(m.HEAPU8.slice(scratch, scratch + k));
        withBytes(b, (p) => m._tls_feed(client, p, b.length));
      }
    }
    assert.equal(m._tls_test_keylog_cap(client, 100), BADARG, 'not after the handshake started');
    got.client = drainLines(client);
    assert.equal(got.client.length, 1, `one line fits in 200 bytes: ${got.client}`);
    assert.match(got.client[0], LINE);
    assert.equal(got.client[0].split(' ')[0], 'CLIENT_HANDSHAKE_TRAFFIC_SECRET');
    assert.ok(got.server.includes(got.client[0]), 'the kept line is whole and right');
    checkShape(got.server, TLS13);
    m._tls_session_free(client);
    m._tls_session_free(server);
  });

  test('flags: TLS_KEYLOG (8) combines with every allowed client and server flag; 16 and the refused combinations stay refused', () => {
    for (const flags of [KEYLOG, KEYLOG | CLIENT.INSECURE, KEYLOG | CLIENT.NO_SNI, KEYLOG | CLIENT.CHAIN_ONLY, KEYLOG | CLIENT.INSECURE | CLIENT.NO_SNI, KEYLOG | CLIENT.NO_SNI | CLIENT.CHAIN_ONLY]) {
      const s = clientSession(flags);
      assert.equal(m._tls_test_keylog_armed(s), 1, `client flags ${flags}`);
      m._tls_session_free(s);
    }
    for (const flags of [16, KEYLOG | 16, KEYLOG | CLIENT.INSECURE | CLIENT.CHAIN_ONLY]) {
      assert.equal(withBytes(Buffer.from('server.test'), (n) => m._tls_client_new_name(store, n, 11, 0, 0, flags)), 0, `client flags ${flags}`);
      assert.equal(m._tls_last_error(), BADARG);
    }
    for (const [flags, ca, useLeaf] of [[KEYLOG, 0, leaf], [KEYLOG | REQUEST_CERT, store, leaf], [KEYLOG | 2, store, leaf], [KEYLOG | SELECT, 0, 0]]) {
      const s = serverSession(flags, { ca, useLeaf });
      assert.equal(m._tls_test_keylog_armed(s), 1, `server flags ${flags}`);
      m._tls_session_free(s);
    }
    for (const [flags, ca] of [[16, 0], [KEYLOG | 16, 0], [KEYLOG | REQUEST_CERT, 0], [KEYLOG | 3, store]]) {
      assert.equal(m._tls_server_new(leaf, 0, 0, ca, flags), 0, `server flags ${flags}`);
      assert.equal(m._tls_last_error(), BADARG);
    }
  });
});

describe('TLS 1.3 EXPORTER_SECRET, as OpenSSL logs it (homescoop#1799)', () => {
  const suites = [['TLS_AES_128_GCM_SHA256', 0x1301, 64], ['TLS_AES_256_GCM_SHA384', 0x1302, 96]];
  const exporter = (ls) => ls.filter((l) => l.startsWith('EXPORTER_SECRET '));

  function five(engineLines, peerLines, suite, hexLen) {
    assert.equal(engineLines.length, 5, `the engine logs five lines on TLS 1.3 (${suite}):\n${engineLines.join('\n')}`);
    assert.equal(peerLines.length, 5, `the peer logs five lines on TLS 1.3 (${suite}):\n${peerLines.join('\n')}`);
    agree(engineLines, peerLines, TLS13);
    assert.equal(exporter(engineLines).length, 1, 'one EXPORTER_SECRET line');
    const want = hexLen ?? engineLines[0].split(' ')[2].length;
    for (const l of engineLines) assert.equal(l.split(' ')[2].length, want, `${suite}: ${l.split(' ')[0]} has the suite's hash length`);
    const [, , exp] = exporter(engineLines)[0].split(' ');
    for (const l of engineLines.filter((x) => !x.startsWith('EXPORTER_SECRET '))) assert.notEqual(l.split(' ')[2], exp, 'the exporter secret is its own secret');
  }

  for (const [suite, iana, hexLen] of suites) {
    test(`a server session, ${suite}: five lines, each one Node tls.connect's keylog line`, async () => {
      const s = serverSession();
      const r = await nodeClient(s, 'TLSv1.3', { ciphers: suite });
      assert.ifError(r.err);
      assert.equal(m._tls_ciphersuite(s), iana, 'the suite Node was pinned to');
      five(r.engine, r.peer, suite, hexLen);
      m._tls_session_free(s);
    });

    test(`a client session, ${suite}: five lines, each one a Node server's keylog line`, async () => {
      const s = clientSession();
      const r = await nodeServer(s, 'TLSv1.3', { ciphers: suite });
      assert.equal(r.state.got, 'ping', `the session: ${r.state.error}`);
      assert.equal(m._tls_ciphersuite(s), iana, 'the suite Node was pinned to');
      five(r.engine, r.peer, suite, hexLen);
      m._tls_session_free(s);
    });
  }

  test('a server session: five lines, each one openssl s_client -keylogfile\'s, EXPORTER_SECRET included', async () => {
    const r = await sClient(() => serverSession(), 'TLSv1.3');
    assert.equal(r.state.got, 'ping\n', `the engine read s_client's data: ${r.out}`);
    five(r.engine, r.peer, 's_client\'s suite', null);
  });

  test('an engine client and server log the same EXPORTER_SECRET line; TLS 1.2 logs none', async () => {
    const client = clientSession();
    const server = serverSession();
    const got = converse(client, server);
    assert.equal(exporter(got.client).length, 1, got.client.join('\n'));
    assert.deepEqual(exporter(got.client), exporter(got.server));
    m._tls_session_free(client);
    m._tls_session_free(server);
    const s = serverSession();
    const r = await nodeClient(s, 'TLSv1.2');
    assert.ifError(r.err);
    assert.deepEqual(r.engine.map((l) => l.split(' ')[0]), ['CLIENT_RANDOM'], 'TLS 1.2: one CLIENT_RANDOM line');
    assert.deepEqual(exporter(r.peer), [], 'Node logs no EXPORTER_SECRET on TLS 1.2 either');
    m._tls_session_free(s);
  });

  test('the EXPORTER_SECRET line is drained and wiped like the others', () => {
    const client = clientSession();
    const server = serverSession();
    const got = converse(client, server);
    const [line] = exporter(got.client);
    assert.ok(line, 'an EXPORTER_SECRET line');
    assert.deepEqual(heapHas([line.split(' ')[2]]), [], 'no copy of its hex after the drain');
    assert.equal(m._tls_test_keylog_residue(client), 0);
    assert.equal(m._tls_test_keylog_residue(server), 0);
    m._tls_session_free(client);
    m._tls_session_free(server);
  });
});
