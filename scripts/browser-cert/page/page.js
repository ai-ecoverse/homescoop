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
window.installTree = async (dir, names) => {
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
  return names.length;
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
};

// Network for cert specs: ctx.serve(fn) installs window.certNet, a responder
// standing in for every remote server. The kernel's proxy, TLS termination
// and HTTP/1.1 stay real; only the far end is the spec's. Without a
// responder every request fails with 502, as with no transport at all.
const certTransport = {
  traits: { manualRedirects: true, encodedBodies: true, crossOrigin: 'any' },
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
// (records the request head, answers once and closes) or { error: 'ECONNREFUSED' }.
// Until then every name is unknown and every dial refused.
window.certUplinkLog = { asked: [], dialled: [], requests: [] };
async function certUplink() {
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
  window.certSetUplink = (cfg) => {
    const peers = {};
    for (const [addr, peer] of Object.entries(cfg.peers ?? {})) {
      peers[addr] = peer.http ? httpPeer(addr, peer.http) : peer;
    }
    fake = fakeUplink({ names: cfg.names ?? {}, peers });
  };
  return {
    traits: { tcp: true, udp: false, ipv6: false },
    routes: { prefixes: ['100.64.0.0/10'] },
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
  const uplink = opts.uplink ? await certUplink() : undefined;
  window.kernel = await createKernel({
    root: await navigator.storage.getDirectory(),
    network: { transport: certTransport, ...(uplink ? { uplink } : {}) },
  });
  document.getElementById('log').textContent = 'kernel ready';
  return true;
};
