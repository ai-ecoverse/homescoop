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

window.boot = async () => {
  if (!crossOriginIsolated) {
    throw new Error('page is not cross-origin isolated (need COOP/COEP)');
  }
  window.kernel = await createKernel({
    root: await navigator.storage.getDirectory(),
  });
  document.getElementById('log').textContent = 'kernel ready';
  return true;
};
