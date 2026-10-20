/**
 * Minimal slicc-kernel boot page for homescoop ladder-pr browser cert.
 * Served with COOP/COEP by @ai-ecoverse/slicc-shared-web/harness.
 */
import { createKernel } from '/dist/index.js';

async function walk(path, create = false) {
  let dir = await navigator.storage.getDirectory();
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Install files listed relative to a served directory into OPFS. */
window.installTree = async (dir, names, modes = {}) => {
  const dirs = new Set(names.map((name) => (dir + name).split('/').slice(0, -1).join('/')));
  for (const path of [...dirs].sort()) await walk(path, true);
  let next = 0;
  const copy = async () => {
    while (next < names.length) {
      const name = names[next++];
      const bytes = await fetchBytes(`/${dir}${name}`);
      const parts = (dir + name).split('/');
      const base = parts.pop();
      const handle = await (await walk(parts.join('/'))).getFileHandle(base, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    }
  };
  await Promise.all(Array.from({ length: 8 }, copy));
  if (typeof window.kernel?.chmod !== 'function') return { files: names.length, stamped: null };
  let stamped = 0;
  for (const [name, mode] of Object.entries(modes)) {
    await window.kernel.chmod(`/${dir}${name}`, mode);
    stamped += 1;
  }
  return { files: names.length, stamped };
};

async function file(path, create = false) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  return (await walk(parts.join('/'), create)).getFileHandle(name, { create });
}

window.opfs = {
  async read(path) {
    try {
      return await (await (await file(path)).getFile()).text();
    } catch {
      return null;
    }
  },
  async write(path, text) {
    const writable = await (await file(path, true)).createWritable();
    await writable.write(text);
    await writable.close();
  },
  // Bytes cross the CDP boundary as base64: a string handed to
  // FileSystemWritableFileStream.write() is UTF-8 encoded (#591), and
  // File.text() decodes as UTF-8 (#738), so neither may carry binary data.
  async writeBase64(path, b64) {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const writable = await (await file(path, true)).createWritable();
    await writable.write(bytes);
    await writable.close();
  },
  async readBase64(path) {
    let bytes;
    try {
      bytes = new Uint8Array(await (await (await file(path)).getFile()).arrayBuffer());
    } catch {
      return null;
    }
    let raw = '';
    for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(raw);
  },
};

// Network for cert specs: ctx.serve(fn) installs window.certNet, a responder
// standing in for every remote server. The kernel's proxy, TLS termination
// and HTTP/1.1 stay real; only the far end is the spec's. Without a
// responder every request fails with 502, as with no transport at all.
// WebSockets for cert specs: ctx.serveWs(fn) installs window.certWs, the far
// end of every WebSocket a program opens through the kernel's proxy (ws:, and
// wss: once the kernel terminates the tunnel). fn gets { url, protocols,
// headers, send(data), close(code, reason) } and answers null (refused) or
// { protocol, message(data), close(code, reason) }, its callbacks for what the
// program sends. Without a responder every open is refused.
window.certWsLog = [];
async function certWebSocket({ url, protocols = [], headers = [] }) {
  if (typeof window.certWs !== 'function') {
    throw Object.assign(new Error('browser-cert: no ctx.serveWs() responder'), { code: 'ECONNREFUSED' });
  }
  const log = { url, protocols, headers, sent: [], received: [], closed: null };
  window.certWsLog.push(log);
  const queue = [];
  let wake = null;
  let ended = null;
  let settle;
  const closed = new Promise((resolve) => (settle = resolve));
  const finish = (code = 1000, reason = '') => {
    if (ended) return;
    ended = { code, reason };
    log.closed = ended;
    settle(ended);
    wake?.();
  };
  const peer = await window.certWs({
    url,
    protocols,
    headers,
    send(data) {
      if (ended) return;
      log.sent.push(typeof data === 'string' ? data : { binary: data.length });
      queue.push(typeof data === 'string' ? data : new Uint8Array(data));
      wake?.();
    },
    close: finish,
  });
  if (!peer) throw Object.assign(new Error('browser-cert: ctx.serveWs() refused the WebSocket'), { code: 'ECONNREFUSED' });
  async function* messages() {
    for (;;) {
      while (queue.length) yield queue.shift();
      if (ended) return;
      await new Promise((resolve) => (wake = resolve));
      wake = null;
    }
  }
  return {
    protocol: peer.protocol ?? '',
    get buffered() {
      return 0;
    },
    send(data) {
      log.received.push(typeof data === 'string' ? data : { binary: data.length });
      peer.message?.(data);
    },
    messages: messages(),
    close(code = 1000, reason = '') {
      peer.close?.(code, reason);
      finish(code, reason);
    },
    closed,
  };
}

const certTransport = {
  traits: { manualRedirects: true, encodedBodies: true, crossOrigin: 'any', websocket: true },
  websocket: certWebSocket,
  async fetch(request) {
    if (typeof window.certNet !== 'function') {
      throw Object.assign(new Error('browser-cert: no ctx.serve() responder'), { status: 502 });
    }
    const body = request.body ? new Uint8Array(await new Response(request.body).arrayBuffer()) : new Uint8Array();
    const res = await window.certNet({ url: request.url, method: request.method, headers: request.headers, body });
    const bytes = typeof res.body === 'string' ? new TextEncoder().encode(res.body) : (res.body ?? new Uint8Array());
    async function* chunks() {
      for (let i = 0; i < bytes.length; i += 16384) yield bytes.slice(i, i + 16384);
    }
    return { status: res.status ?? 200, statusText: res.statusText ?? '', headers: res.headers ?? [], body: chunks(), cancel: async () => {} };
  },
};

// Tailnet for cert specs (cert/meta.json "uplink": true, slicc-kernel >=
// 1.28.0): the kernel boots with an uplink routing 100.64.0.0/10, the range
// a tailnet uses, and ctx.uplink({ names, peers }) decides what it answers.
// Names map to address lists; a peer "ip:port" is { http: { status, headers, body } }
// (records the request head, answers once and closes), { tcp: '<function source>' }
// (raw bytes: the function gets { tcp: <bytes so far>, peer } after every read and
// returns null for "need more", or the reply bytes; the peer writes them and
// closes) or { error: 'ECONNREFUSED' }.
// Until then every name is unknown and every dial refused.
window.certUplinkLog = { asked: [], dialled: [], requests: [] };
async function certUplink(nameserver) {
  const { fakeUplink } = await import('/dist/testing.js');
  let fake = fakeUplink({});
  const httpPeer = (addr, { status = 200, headers = [], body = '' }) => (conn) => {
    void (async () => {
      let head = '';
      while (!head.includes('\r\n\r\n')) {
        const piece = await conn.read();
        if (!piece) break;
        head += new TextDecoder().decode(piece);
      }
      window.certUplinkLog.requests.push({ peer: addr, head: head.split('\r\n\r\n')[0] });
      const bytes = new TextEncoder().encode(body);
      const extra = headers.map(([k, v]) => `${k}: ${v}\r\n`).join('');
      conn.write(new TextEncoder().encode(
        `HTTP/1.1 ${status} X\r\n${extra}Content-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`,
      ));
      conn.write(bytes);
      conn.end();
    })();
  };
  const tcpPeer = (addr, src) => (conn) => {
    const fn = new Function(`return (${src})`)();
    void (async () => {
      let got = new Uint8Array();
      for (;;) {
        const piece = await conn.read();
        if (piece) {
          const next = new Uint8Array(got.length + piece.length);
          next.set(got);
          next.set(piece, got.length);
          got = next;
        }
        const reply = await fn({ tcp: got, peer: addr });
        if (reply || !piece) {
          window.certUplinkLog.requests.push({ peer: addr, bytes: got.length });
          if (reply) conn.write(typeof reply === 'string' ? new TextEncoder().encode(reply) : reply);
          conn.end();
          return;
        }
      }
    })();
  };
  window.certSetUplink = (cfg) => {
    const peers = {};
    for (const [addr, peer] of Object.entries(cfg.peers ?? {})) {
      peers[addr] = peer.http ? httpPeer(addr, peer.http) : peer.tcp ? tcpPeer(addr, peer.tcp) : peer;
    }
    fake = fakeUplink({ names: cfg.names ?? {}, peers });
  };
  return {
    traits: { tcp: true, udp: false, ipv6: false },
    routes: { prefixes: ['100.64.0.0/10'] },
    // cert/meta.json "uplink": { "nameserver": "<addr>" } (slicc-kernel >=
    // 1.137.0): the kernel's DNS stub forwards what it can't answer there.
    ...(nameserver ? { nameserver } : {}),
    resolve: (name, family, signal) => {
      window.certUplinkLog.asked.push({ name, family });
      return fake.resolve(name, family, signal);
    },
    dial: (req) => {
      window.certUplinkLog.dialled.push({ host: req.host, port: req.port });
      return fake.dial(req);
    },
  };
}

window.boot = async (opts = {}) => {
  if (!crossOriginIsolated) {
    throw new Error('page is not cross-origin isolated (need COOP/COEP)');
  }
  const uplink = opts.uplink ? await certUplink(opts.uplinkNameserver) : undefined;
  window.kernel = await createKernel({
    root: await navigator.storage.getDirectory(),
    network: { transport: certTransport, ...(uplink ? { uplink } : {}) },
    ...(opts.users ? { users: opts.users } : {}),
  });
  document.getElementById('log').textContent = 'kernel ready';
  return true;
};
