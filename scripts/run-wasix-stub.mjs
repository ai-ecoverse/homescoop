#!/usr/bin/env node
/**
 * Run a WASI command wasm that also imports wasix_32v1, with stub process
 * imports (ENODEV / unused). Enough for zig version / build-exe PRESTAGE
 * without a full SLICC WASIX realm. Real spawn is exercised in SLICC.
 *
 * Usage: run-wasix-stub.mjs <wasm> [--dir host::guest ...] -- <argv...>
 */
import fs from 'node:fs';
import path from 'node:path';
import { WASI } from 'node:wasi';

const ESUCCESS = 0;
const ENOTSUP = 58;
const ENODEV = 19;

function parseArgs(argv) {
  const dirs = [];
  let i = 2;
  const wasm = argv[i++];
  if (!wasm) {
    console.error('usage: run-wasix-stub.mjs <wasm> [--dir host::guest]... -- <args...>');
    process.exit(2);
  }
  while (i < argv.length && argv[i] !== '--') {
    if (argv[i] === '--dir') {
      const spec = argv[++i];
      const sep = spec.indexOf('::');
      if (sep < 0) throw new Error(`bad --dir ${spec}`);
      dirs.push([spec.slice(0, sep), spec.slice(sep + 2)]);
      i++;
    } else {
      throw new Error(`unknown arg ${argv[i]}`);
    }
  }
  if (argv[i] === '--') i++;
  const args = argv.slice(i);
  return { wasm, dirs, args };
}

const { wasm, dirs, args } = parseArgs(process.argv);
const preopens = {};
for (const [host, guest] of dirs) {
  preopens[guest || '/'] = path.resolve(host);
}

// Pass through host env, but never inject empty ZIG_* overrides — Zig treats
// empty ZIG_LIB_DIR / ZIG_GLOBAL_CACHE_DIR as set and then fails equality checks.
const env = { ...process.env };
for (const k of ['ZIG_LIB_DIR', 'ZIG_GLOBAL_CACHE_DIR', 'ZIG_EXE']) {
  if (env[k] === '') delete env[k];
}

const wasi = new WASI({
  version: 'preview1',
  args: args.length ? args : [path.basename(wasm)],
  env,
  preopens: Object.keys(preopens).length ? preopens : { '/': process.cwd() },
  returnOnExit: true,
});

/** Minimal wasix_32v1 so instantiate succeeds; spawn/join unused for build-exe. */
function wasixStub() {
  const nosup = () => ENOTSUP;
  return new Proxy(
    {
      fd_pipe: (rPtr, wPtr) => {
        // Leave zeros — unused when not spawning.
        void rPtr;
        void wPtr;
        return ENOTSUP;
      },
      proc_spawn3: () => ENOTSUP,
      proc_spawn2: () => ENOTSUP,
      proc_join: () => ENOTSUP,
      proc_signal: () => ENOTSUP,
      proc_exec3: () => ENOTSUP,
      proc_exec4: () => ENOTSUP,
    },
    {
      get(t, prop) {
        if (prop in t) return t[prop];
        return nosup;
      },
    },
  );
}

const buf = fs.readFileSync(wasm);
const { instance } = await WebAssembly.instantiate(buf, {
  wasi_snapshot_preview1: wasi.wasiImport,
  wasix_32v1: wasixStub(),
});

if (!instance.exports._start && !instance.exports._initialize) {
  console.error('no _start/_initialize export');
  process.exit(1);
}
const code = wasi.start(instance);
process.exit(code === undefined ? 0 : code);
