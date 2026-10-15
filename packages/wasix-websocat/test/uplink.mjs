import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const tarball = arg('--tarball');
const kernelSpec = arg('--kernel') ?? meta.kernel;
assert.ok(tarball, 'usage: uplink.mjs --tarball <package.tgz> [--kernel <spec>]');
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();
const ADDR = '93.184.216.34';
const NAME = 'echo.test';

function wsHandler(seen) {
  return (req, socket, head) => {
    seen.push({ host: req.headers.host, url: req.url, sni: socket.servername ?? null });
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    const frame = (op, payload) => {
      const n = payload.length;
      const hdr = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
      socket.write(Buffer.concat([hdr, payload]));
    };
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (buf[1] & 128) !== 0;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        buf = buf.subarray(off + len);
        if (op === 8) { frame(8, payload); socket.end(); return; }
        if (op === 9) frame(10, payload);
        else if (op === 1 || op === 2 || op === 0) frame(op, payload);
      }
    });
    socket.on('error', () => {});
  };
}

function uplinkFor(ports) {
  return {
    traits: { tcp: true, udp: false, ipv6: false },
    routes: { prefixes: [], exit: true },
    resolve: async (name) => (name === NAME ? [ADDR] : []),
    dial: ({ host, port }) => new Promise((ok, fail) => {
      const to = host === ADDR ? ports[port] : undefined;
      if (!to) return fail(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
      const s = connect(to, '127.0.0.1');
      const chunks = [];
      const waiters = [];
      let ended = false;
      const push = (v) => (waiters.length ? waiters.shift()(v) : chunks.push(v));
      s.on('data', (d) => push(new Uint8Array(d)));
      s.on('end', () => { ended = true; push(null); });
      s.on('error', (e) => { if (!ended) { ended = true; push(null); } fail(e); });
      s.once('connect', () => ok({
        localAddr: { host: '100.100.100.100', port: s.localPort },
        remoteAddr: { host, port },
        read: () => (chunks.length ? Promise.resolve(chunks.shift()) : ended ? Promise.resolve(null) : new Promise((r) => waiters.push(r))),
        write: (bytes) => new Promise((r) => s.write(Buffer.from(bytes), () => r(bytes.length))),
        closeWrite: async () => { s.end(); },
        close: async () => { s.destroy(); },
      }));
    }),
  };
}

const work = mkdtempSync(join(tmpdir(), 'wasix-websocat-uplink-'));
let k;
const servers = [];
try {
  const pki = join(work, 'pki');
  mkdirSync(pki);
  const ssl = (...a) => sh('openssl', a, { cwd: pki, stdio: ['ignore', 'pipe', 'pipe'] });
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=homescoop throwaway test CA');
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', `/CN=${NAME}`);
  writeFileSync(join(pki, 'ext.cnf'), `subjectAltName=DNS:${NAME}\n`);
  ssl('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', 'ext.cnf');
  const seen = [];
  const plain = createHttpServer((q, r) => { r.statusCode = 404; r.end(); });
  const tls = createHttpsServer({ key: readFileSync(join(pki, 'srv.key')), cert: readFileSync(join(pki, 'srv.pem')) }, (q, r) => { r.statusCode = 404; r.end(); });
  for (const srv of [plain, tls]) {
    srv.on('upgrade', wsHandler(seen));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
  }
  const ports = { 80: plain.address().port, 443: tls.address().port };
  console.log(`== host echo servers: ws on 127.0.0.1:${ports[80]}, wss (throwaway CA) on 127.0.0.1:${ports[443]}; ${NAME} → ${ADDR} via the uplink`);

  const pkg = join(work, 'pkg');
  mkdirSync(pkg);
  sh('tar', ['xzf', resolve(tarball), '-C', pkg]);
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec]);
  const kroot = join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  k = await createNodeKernel({ users: 'enforce', network: { uplink: uplinkFor(ports) } });
  await k.setRoutes({ prefixes: [], exit: true });
  const name = JSON.parse(readFileSync(join(pkg, 'package/package.json'), 'utf8')).name;
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
      else await k.writeFile(`${dest}/${e}`, readFileSync(p));
    }
  };
  await copyTree(join(pkg, 'package'), `/node_modules/${name}`);
  const run = (argv, stdin) => Promise.race([
    k.run(argv, { cwd: '/home', env: {}, stdin }),
    new Promise((r) => setTimeout(() => r({ status: 'no exit within 30 s', stdout: '', stderr: '' }), 30000)),
  ]);
  for (let i = 0; ; i++) {
    const r = await run(['websocat', '--version']);
    if (r.status === 0) { console.log(`== kernel ${kver} (Node entry, users enforce): ${r.stdout.trim()}`); break; }
    if (i >= 100) assert.fail(`websocat --version: ${r.status} ${r.stdout}${r.stderr}`);
    await new Promise((res) => setTimeout(res, 200));
  }

  const ws = await run(['websocat', `ws://${NAME}/`], 'hello uplink\nsecond line\n');
  assert.equal(ws.status, 0, `ws:// through the uplink: ${ws.status} ${ws.stdout}${ws.stderr}`);
  assert.equal(ws.stdout, 'hello uplink\nsecond line\n');
  console.log('ok ws:// through the uplink: two text messages echo');

  const big = `${'uplink binary 0123456789abcdef'.repeat(32)}\n`.repeat(4096);
  const bin = await run(['websocat', '-b', `ws://${NAME}/`], big);
  assert.equal(bin.status, 0, `ws:// binary: ${bin.status} ${bin.stderr}`);
  assert.ok(bin.stdout === big, `ws:// ${big.length}-byte binary round trip is byte-equal (got ${bin.stdout.length})`);
  console.log(`ok ws:// binary ${big.length} bytes through the uplink, byte-equal`);

  const wss = await run(['websocat', '-k', `wss://${NAME}/`], 'hello tls\n');
  assert.equal(wss.status, 0, `wss:// -k: ${wss.status} ${wss.stdout}${wss.stderr}`);
  assert.equal(wss.stdout, 'hello tls\n');
  console.log('ok wss:// -k through the uplink: TLS handshake (rustls) and framing; the throwaway CA is not in webpki-roots');

  const strict = await run(['websocat', `wss://${NAME}/`], 'x\n');
  assert.notEqual(strict.status, 0, 'wss:// without -k must refuse the throwaway CA');
  assert.match(strict.stdout + strict.stderr, /UnknownIssuer|invalid peer certificate|certificate/i);
  console.log(`ok wss:// without -k refuses the throwaway CA (rc ${strict.status}): chain verification is on, against the embedded webpki roots`);

  const refused = await run(['websocat', `ws://${NAME}:81/`], 'x\n');
  assert.equal(refused.status, 14, `refused through the uplink: ${refused.status} ${refused.stdout}${refused.stderr}`);
  assert.match(refused.stdout + refused.stderr, /Connection refused/);
  const unknown = await run(['websocat', 'ws://nothere.test/'], 'x\n');
  assert.equal(unknown.status, 21, `unknown name: ${unknown.status} ${unknown.stdout}${unknown.stderr}`);
  console.log('ok a refused port is rc 14 and a name the uplink does not know is rc 21');

  assert.ok(seen.some((s) => s.host === NAME && s.sni === null), `the ws server saw Host ${NAME}: ${JSON.stringify(seen)}`);
  assert.ok(seen.some((s) => s.host === NAME && s.sni === NAME), `the wss server saw SNI ${NAME}: ${JSON.stringify(seen)}`);
  console.log('ok the servers saw Host and SNI echo.test');
} finally {
  for (const s of servers) s.close();
  if (k) await k.terminate?.();
  rmSync(work, { recursive: true, force: true });
}
