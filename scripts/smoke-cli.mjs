#!/usr/bin/env node
/**
 * Minimal smoke runner for homescoop Emscripten CLIs.
 * Mounts a host directory at /work via NODEFS and calls Module.callMain.
 *
 *   node scripts/smoke-cli.mjs <glue.js> -- [args...]
 *   SMOKE_WORKDIR=/tmp/foo node scripts/smoke-cli.mjs … -- init
 *
 * Optional: SMOKE_ENV=KEY=val,KEY2=val2
 * Optional curl loopback: SMOKE_HTTP=1 starts a tiny Node HTTP server and
 * injects Module.sliccKernel.net (inet stream sockets over Node net).
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
if (dash < 0 || dash === 0) {
  console.error('usage: smoke-cli.mjs <glue.js> -- [args...]');
  process.exit(2);
}
const glue = resolve(argv[0]);
const progArgs = argv.slice(dash + 1);
const work = resolve(process.env.SMOKE_WORKDIR || join(process.cwd(), '.smoke-work'));
fs.mkdirSync(work, { recursive: true });

const envPairs = (process.env.SMOKE_ENV || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {import('http').Server | null} */
let httpServer = null;
let httpPort = 0;

function makeNetKernel() {
  /** @type {Map<number, any>} */
  const socks = new Map();
  let nextFd = 100;

  function allocFd(sock) {
    const fd = nextFd++;
    socks.set(fd, sock);
    return fd;
  }

  return {
    socket(_type, nonblock) {
      const s = { kind: 'inet', nonblock: !!nonblock, node: null, peer: null, listening: false, backlog: [] };
      return allocFd(s);
    },
    socketpair() {
      return -38; // ENOSYS
    },
    bind(fd, addr) {
      const s = socks.get(fd);
      if (!s) return -9;
      s.local = addr;
      return 0;
    },
    listen(fd, backlog) {
      const s = socks.get(fd);
      if (!s) return -9;
      s.listening = true;
      s.backlogMax = backlog || 5;
      return 0;
    },
    connect(fd, addr) {
      const s = socks.get(fd);
      if (!s) return -9;
      const host = addr.host === '127.0.0.1' || addr.host === '0.0.0.0' ? '127.0.0.1' : addr.host;
      const port = addr.port;
      const sock = net.connect({ host, port });
      s.node = sock;
      s.peer = addr;
      s.buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        s.buf = Buffer.concat([s.buf, chunk]);
      });
      // Block until connected (sync enough for smoke).
      const start = Date.now();
      while (!sock.readable && Date.now() - start < 5000) {
        require('node:child_process').execSync('sleep 0.01');
      }
      return sock.destroyed ? -111 : 0;
    },
    accept() {
      return -11; // EAGAIN — not needed for client curl
    },
    name(fd, peer) {
      const s = socks.get(fd);
      if (!s) return -9;
      const a = peer ? s.peer : s.local;
      if (!a) return -22;
      return a;
    },
    getopt() {
      return { value: 0 };
    },
    setopt() {
      return 0;
    },
    send(fd, bytes) {
      const s = socks.get(fd);
      if (!s?.node) return -9;
      s.node.write(Buffer.from(bytes));
      return bytes.length;
    },
    recv(fd, len, opts = {}) {
      const s = socks.get(fd);
      if (!s?.node) return -9;
      const start = Date.now();
      while (s.buf.length === 0 && !s.node.readableEnded && Date.now() - start < 5000) {
        require('node:child_process').execSync('sleep 0.01');
      }
      if (s.buf.length === 0) return s.node.readableEnded ? 0 : -11;
      const n = Math.min(len, s.buf.length);
      const out = s.buf.subarray(0, n);
      if (!opts.peek) s.buf = s.buf.subarray(n);
      return new Uint8Array(out);
    },
  };
}

async function main() {
  if (process.env.SMOKE_HTTP === '1') {
    httpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('homescoop-ok\n');
    });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    httpPort = httpServer.address().port;
    console.error(`smoke-cli: HTTP loopback on 127.0.0.1:${httpPort}`);
  }

  const Module = {
    noInitialRun: true,
    arguments: progArgs,
    locateFile(path) {
      return join(dirname(glue), path);
    },
    preRun: [
      function () {
        const { FS } = Module;
        FS.mkdir('/work');
        FS.mount(FS.filesystems.NODEFS, { root: work }, '/work');
        FS.chdir('/work');
        for (const pair of envPairs) {
          const i = pair.indexOf('=');
          if (i > 0) {
            // Emscripten ENV is populated before main; set via ENV map if present
            globalThis.ENV = globalThis.ENV || {};
          }
        }
      },
    ],
    onRuntimeInitialized() {},
  };

  if (process.env.SMOKE_HTTP === '1') {
    Module.sliccKernel = { net: makeNetKernel(), select() { return { read: [], write: [] }; } };
  }

  // Load glue as CJS into Module
  const code = fs.readFileSync(glue, 'utf8');
  // Emulate classic emscripten module pattern
  const m = { exports: Module };
  const fn = new Function('Module', 'exports', 'require', '__dirname', '__filename', 'process', code + '\n;return Module;');
  const loaded = fn(Module, m.exports, require, dirname(glue), glue, process);

  // Wait for wasm
  const deadline = Date.now() + 30000;
  while (!loaded.callMain && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!loaded.callMain) {
    console.error('smoke-cli: callMain not ready');
    process.exit(1);
  }

  let args = progArgs;
  if (process.env.SMOKE_HTTP === '1') {
    args = progArgs.map((a) => a.replace(/__PORT__/g, String(httpPort)));
  }

  let status = 0;
  try {
    status = loaded.callMain(args) ?? 0;
  } catch (e) {
    if (e && e.name === 'ExitStatus') status = e.status;
    else throw e;
  }

  if (httpServer) httpServer.close();
  process.exit(status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
