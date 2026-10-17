#!/usr/bin/env node
/**
 * The wasi-sdk a Rust release builds its self-contained wasm32-wasip1 libc
 * from, against the tag homescoop_notice_rust names (#472).
 *
 *   node scripts/check-rust-wasi-sdk.mjs <rust-version> <wasi-sdk-N> [--dockerfile <file>]
 *
 * Reads WASI_SDK_PATH=/tmp/wasi-sdk-<N>.<M>-… from the release's
 * src/ci/docker/host-x86_64/dist-various-2/Dockerfile (or --dockerfile).
 */
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';

export const dockerfileUrl = (rust) =>
  `https://raw.githubusercontent.com/rust-lang/rust/${rust}/src/ci/docker/host-x86_64/dist-various-2/Dockerfile`;

export function wasiSdkOf(dockerfile) {
  const tags = [...dockerfile.matchAll(/WASI_SDK_PATH=\S*?wasi-sdk-(\d+)(?:\.\d+)?/g)].map((m) => `wasi-sdk-${m[1]}`);
  const unique = [...new Set(tags)];
  if (unique.length !== 1) throw new Error(unique.length ? `more than one WASI_SDK_PATH: ${unique.join(', ')}` : 'no WASI_SDK_PATH=…wasi-sdk-<N> line');
  return unique[0];
}

async function fetchText(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      last = new Error(`${url}: HTTP ${res.status}`);
      if (res.status === 404) break;
    } catch (err) {
      last = new Error(`${url}: ${err.message}`);
    }
    await new Promise((done) => setTimeout(done, attempt * 2000));
  }
  throw last;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dockerfile');
  const file = i >= 0 ? args.splice(i, 2)[1] : '';
  const [rust, tag] = args;
  if (!rust || !/^wasi-sdk-\d+$/.test(tag || '')) {
    console.error('usage: check-rust-wasi-sdk.mjs <rust-version> <wasi-sdk-N> [--dockerfile <file>]');
    return 2;
  }
  const source = file || dockerfileUrl(rust);
  let found;
  try {
    found = wasiSdkOf(file ? readFileSync(file, 'utf8') : await fetchText(source));
  } catch (err) {
    console.error(`check-rust-wasi-sdk: Rust ${rust}: ${err.message} (${source})`);
    return 1;
  }
  if (found !== tag) {
    console.error(`check-rust-wasi-sdk: Rust ${rust} builds its wasi-libc from ${found} (${source}), but homescoop_notice_rust names ${tag}; fix the table in scripts/build-common.sh`);
    return 1;
  }
  console.log(`check-rust-wasi-sdk: Rust ${rust} builds its wasi-libc from ${found}, as the notice says`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(await main());
