#!/usr/bin/env node
/**
 * Run one homescoop Emscripten CLI once (EXIT_RUNTIME=1).
 * Mounts SMOKE_WORKDIR (default .) at /work via NODEFS.
 *
 *   node scripts/run-wasm-cli.mjs packages/git/package/bin/git -- init
 *   SMOKE_HTTP=1 node scripts/run-wasm-cli.mjs packages/curl/package/bin/curl -- http://127.0.0.1:__PORT__/
 *
 * When the tool forks+execs a helper (git-upload-pack, …), a smoke sliccKernel
 * re-invokes this runner against the matching glue under bin/ or libexec/.
 */
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const selfPath = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
if (dash < 1) {
  console.error('usage: run-wasm-cli.mjs <glue> -- [args...]');
  process.exit(2);
}
const glue = resolve(argv[0]);
let progArgs = argv.slice(dash + 1);
const work = resolve(process.env.SMOKE_WORKDIR || process.cwd());
fs.mkdirSync(work, { recursive: true });
const pkgRoot = dirname(dirname(glue));
const execPath = join(pkgRoot, 'libexec', 'git-core');
const binPath = join(pkgRoot, 'bin');

let httpServer = null;
let httpPort = 0;
let nextPid = 2000;
const childStatus = new Map();

function spin(ms) {
  try {
    execSync(`sleep ${ms / 1000}`);
  } catch {
    /* ignore */
  }
}

function resolveHelperGlue(file) {
  const base = basename(file);
  for (const dir of [binPath, execPath, dirname(glue)]) {
    const cand = join(dir, base);
    if (fs.existsSync(cand)) return cand;
  }
  // argv0 builtin: fall back to main git glue (looks up git.wasm)
  if (base.startsWith('git-') && fs.existsSync(join(binPath, 'git'))) {
    return join(binPath, 'git');
  }
  return null;
}

function makeSpawnKernel() {
  return {
    spawn(file, args, env, cwd) {
      let helper = resolveHelperGlue(file);
      let mainArgs = args.slice(1);
      // git often runs: /bin/sh -c "git-upload-pack 'path'"
      if (
        (file === '/bin/sh' || file === '/bin/bash' || basename(file) === 'sh') &&
        mainArgs[0] === '-c' &&
        mainArgs[1]
      ) {
        const cmd = mainArgs[1];
        const m = cmd.match(/^([\w.-]+)\s+'([^']+)'\s*$/) || cmd.match(/^([\w.-]+)\s+(\S+)\s*$/);
        if (m) {
          helper = resolveHelperGlue(m[1]);
          mainArgs = [m[2]];
        }
      }
      if (!helper) return -44; // ENOENT
      const pid = nextPid++;
      const r = spawnSync(
        process.execPath,
        [selfPath, helper, '--', ...mainArgs],
        {
          cwd: cwd || work,
          env: {
            ...process.env,
            ...(env || {}),
            SMOKE_WORKDIR: work,
            SMOKE_NESTED: '1',
          },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      if (r.error) return r.error.code === 'ENOENT' ? -44 : -29;
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      const status = r.status ?? (r.signal ? 128 : 1);
      childStatus.set(pid, status << 8);
      return pid;
    },
    execWait(pid) {
      if (!childStatus.has(pid)) return -1;
      const st = childStatus.get(pid);
      childStatus.delete(pid);
      return st;
    },
  };
}



function makeNetKernel(FS) {
  const socks = new Map();
  let sockN = 0;
  const spin = (ms) => {
    try { execSync(`sleep ${ms / 1000}`); } catch { /* ignore */ }
  };
  try { FS.mkdir('/dev'); } catch { /* exists */ }
  const api = {
    _socks: socks,
    socket() {
      const sock = { buf: Buffer.alloc(0), node: null, peer: null, local: null };
      const id = sockN++;
      const dev = FS.makedev(240, id);
      FS.registerDevice(dev, {
        open(stream) {
          stream.sock = sock;
        },
        read(stream, buffer, offset, length) {
          const r = api.recv(stream.fd, length, {});
          if (typeof r === 'number') {
            if (r === -11) throw new FS.ErrnoError(6); // EAGAIN
            if (r < 0) throw new FS.ErrnoError(-r);
            return 0;
          }
          buffer.set(r, offset);
          return r.length;
        },
        write(stream, buffer, offset, length) {
          const n = api.send(stream.fd, buffer.subarray(offset, offset + length));
          if (n < 0) throw new FS.ErrnoError(-n);
          return n;
        },
        poll(stream) {
          const s = socks.get(stream.fd);
          let mask = 0;
          if (s?.node && !s.node.destroyed) mask |= 4 | 256;
          if (s?.buf?.length || s?.node?.readableEnded) mask |= 1 | 64;
          return mask;
        },
        close(stream) {
          const s = socks.get(stream.fd);
          try { s?.node?.end?.(); } catch { /* ignore */ }
          socks.delete(stream.fd);
        },
      });
      const path = `/dev/slicc-sock-${id}`;
      try { FS.unlink(path); } catch { /* ignore */ }
      FS.mkdev(path, 0o666, dev);
      const stream = FS.open(path, 2);
      sock.stream = stream;
      socks.set(stream.fd, sock);
      return stream.fd;
    },
    socketpair() { return -38; },
    bind(fd, addr) {
      const s = socks.get(fd);
      if (!s) return -9;
      s.local = addr;
      return 0;
    },
    listen() { return 0; },
    connect(fd, addr) {
      const s = socks.get(fd);
      if (!s) return -9;
      const host = addr.host === '0.0.0.0' || addr.host === '127.0.0.1' ? '127.0.0.1' : addr.host;
      const nodeSock = net.connect({ host, port: addr.port });
      s.node = nodeSock;
      s.peer = addr;
      s.buf = Buffer.alloc(0);
      let ok = false, err = null;
      nodeSock.on('connect', () => { ok = true; });
      nodeSock.on('error', (e) => { err = e; });
      nodeSock.on('data', (c) => { s.buf = Buffer.concat([s.buf, c]); });
      const t0 = Date.now();
      while (!ok && !err && Date.now() - t0 < 5000) spin(10);
      return err ? -111 : 0;
    },
    accept() { return -11; },
    name(fd, peer) {
      const s = socks.get(fd);
      if (!s) return -9;
      return peer ? (s.peer || { family: 'inet', host: '127.0.0.1', port: 0 })
                  : (s.local || { family: 'inet', host: '127.0.0.1', port: 0 });
    },
    getopt() { return { value: 0 }; },
    setopt() { return 0; },
    send(fd, bytes) {
      const s = socks.get(fd);
      if (!s?.node) return -9;
      s.node.write(Buffer.from(bytes));
      return bytes.length;
    },
    recv(fd, len, opts = {}) {
      const s = socks.get(fd);
      if (!s?.node) return -9;
      const t0 = Date.now();
      while (s.buf.length === 0 && !s.node.readableEnded && Date.now() - t0 < 5000) spin(10);
      if (s.buf.length === 0) return s.node.readableEnded ? 0 : -11;
      const n = Math.min(len, s.buf.length);
      const out = s.buf.subarray(0, n);
      if (!opts.peek) s.buf = s.buf.subarray(n);
      return new Uint8Array(out);
    },
  };
  return api;
}

async function main() {
  if (process.env.SMOKE_HTTP === '1') {
    httpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('homescoop-ok\n');
    });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    httpPort = httpServer.address().port;
    console.error(`run-wasm-cli: HTTP 127.0.0.1:${httpPort}`);
    progArgs = progArgs.map((a) => a.replaceAll('__PORT__', String(httpPort)));
  }

  const spawnPart = makeSpawnKernel();
  const Module = {
    noInitialRun: true,
    locateFile: (p) => {
      if (fs.existsSync(join(dirname(glue), p))) return join(dirname(glue), p);
      if (fs.existsSync(join(execPath, p))) return join(execPath, p);
      if (fs.existsSync(join(binPath, p))) return join(binPath, p);
      return join(dirname(glue), p);
    },
    preRun: [
      () => {
        Module.ENV = Module.ENV || {};
        Module.ENV.PATH = `/git-core:/usr/bin:/bin`;
        Module.ENV.GIT_EXEC_PATH = '/git-core';
        Module.ENV.GIT_TEMPLATE_DIR = '';
      },
    ],
    onRuntimeInitialized() {
      Module.__ready = true;
    },
    sliccKernel: { ...spawnPart },
  };

  global.Module = Module;
  const M = require(glue);
  // Glue's `var Module` shadows global; put kernel on the exported object EM_JS closes over.
  M.sliccKernel = Module.sliccKernel;
  M.ENV = Object.assign(M.ENV || {}, Module.ENV || {});
  for (let i = 0; i < 400 && !Module.__ready && !M.calledRun; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const FS = M.FS;
  if (process.env.SMOKE_HTTP === '1') {
    const net = makeNetKernel(FS);
    M.sliccKernel.net = net;
    M.sliccKernel.select = (read = [], write = [], timeout_ms = 0) => {
      const t0 = Date.now();
      const timeout = timeout_ms < 0 ? 5000 : timeout_ms;
      for (;;) {
        const rdy = { read: [], write: [] };
        for (const fd of read) {
          const s = net._socks?.get(fd);
          if (s?.buf?.length || s?.node?.readableEnded) rdy.read.push(fd);
        }
        for (const fd of write) {
          const s = net._socks?.get(fd);
          if (s?.node && !s.node.destroyed) rdy.write.push(fd);
        }
        if (rdy.read.length || rdy.write.length) return rdy;
        if (Date.now() - t0 >= timeout) return rdy;
        spin(5);
      }
    };
  }
  if (!FS?.filesystems?.NODEFS) {
    console.error('run-wasm-cli: NODEFS missing — rebuild with -lnodefs.js');
    process.exit(1);
  }
  const ensureMount = (path, root) => {
    try { FS.mkdir(path); } catch (e) { /* exists */ }
    try {
      FS.mount(FS.filesystems.NODEFS, { root }, path);
    } catch (e) {
      if (e?.errno !== 28 && e?.errno !== 20) {
        console.error('mount', path, '->', root, e?.errno || e);
      }
    }
  };
  ensureMount('/work', work);
  if (fs.existsSync(execPath)) ensureMount('/git-core', execPath);
  try { FS.chdir('/work'); } catch (e) { console.error('chdir', e?.errno || e); }

  const mainFn =
    typeof M.sliccRunMain === 'function' ? M.sliccRunMain.bind(M) : M.callMain.bind(M);
  let status = 0;
  try {
    status = (await Promise.resolve(mainFn(progArgs))) ?? 0;
  } catch (e) {
    if (e?.name === 'ExitStatus') status = e.status;
    else throw e;
  }
  if (httpServer) await new Promise((r) => httpServer.close(r));
  process.exit(status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
