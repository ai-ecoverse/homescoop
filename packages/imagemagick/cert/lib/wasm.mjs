import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Small wasm helpers for the relink checks of imagemagick and imagemagick-heif.

/** Custom sections of a wasm binary: Map of name to size in bytes. */
export function customSections(wasm) {
  const out = new Map();
  let o = 8;
  const leb = () => {
    let r = 0;
    let s = 0;
    let x;
    do {
      x = wasm[o++];
      r += (x & 0x7f) * 2 ** s;
      s += 7;
    } while (x & 0x80);
    return r;
  };
  while (o < wasm.length) {
    const id = wasm[o++];
    const size = leb();
    const start = o;
    if (id === 0) {
      const n = leb();
      out.set(Buffer.from(wasm.subarray(o, o + n)).toString(), size);
    }
    o = start + size;
  }
  return out;
}

/** Sorted import and export names of a compiled module. */
export function signature(wasm) {
  const mod = new WebAssembly.Module(wasm);
  return {
    imports: WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}:${i.kind}`).sort(),
    exports: WebAssembly.Module.exports(mod).map((e) => `${e.name}:${e.kind}`).sort(),
  };
}

/** Throws unless both binaries have the same imports and exports. */
export function sameSignature(relinked, shipped, what = 'magick.wasm') {
  const a = signature(relinked);
  const b = signature(shipped);
  for (const k of ['imports', 'exports']) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      const only = (x, y) => x.filter((n) => !y.includes(n));
      throw new Error(`relinked ${what} ${k} differ: only relinked ${only(a[k], b[k]).join(' ')}; only shipped ${only(b[k], a[k]).join(' ')}`);
    }
  }
  return a;
}

/**
 * Throws unless the relink kit's ldflags.txt names only files inside the kit:
 * no absolute path (the build host's), and every --js-library present.
 * Returns the --js-library files.
 */
export function checkKitFlags(kit) {
  const words = readFileSync(join(kit, 'ldflags.txt'), 'utf8').trim().split(/\s+/);
  const abs = words.filter((w) => w.startsWith('/'));
  if (abs.length) throw new Error(`relink kit ldflags.txt names build-host paths: ${abs.join(' ')}`);
  const js = words.flatMap((w, i) => (words[i - 1] === '--js-library' ? [w] : []));
  if (!js.length) throw new Error('relink kit ldflags.txt names no --js-library');
  const files = [...js, ...words.filter((w) => w.endsWith('.a'))];
  const missing = files.filter((f) => !existsSync(join(kit, f)));
  if (missing.length) throw new Error(`relink kit lacks ${missing.join(', ')}, which its ldflags.txt names`);
  return js;
}
