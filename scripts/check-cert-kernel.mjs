#!/usr/bin/env node
/**
 * The cert harness's default kernel, the root package.json devDependency
 * @ai-ecoverse/slicc-kernel, is a certified release.
 *
 *   node scripts/check-cert-kernel.mjs
 *
 * Passes only when the pin is an exact version, the ai-ecoverse/slicc-kernel
 * release v<pin> has a `certified @ai-ecoverse/slicc-kernel@<pin> sha256=<hex>`
 * line, and the registry tarball of that version re-hashes to that sha256
 * (as the coordinator's tag-certified.sh does). Any network or parse error
 * fails. slicc-kernel-negative, the old negative-proof kernel, is not checked.
 * GITHUB_TOKEN, when set, authenticates the release lookup.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXACT } from './check-exact-pins.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = '@ai-ecoverse/slicc-kernel';
const REPO = 'ai-ecoverse/slicc-kernel';
const REGISTRY = 'https://registry.npmjs.org/';
const TIMEOUT_MS = 120_000;

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res;
}

export const defaultFetchers = {
  async release(tag) {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return (await get(`https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`, headers)).json();
  },
  async manifest(version) {
    return (await get(`${REGISTRY}${KERNEL.replace('/', '%2f')}/${encodeURIComponent(version)}`)).json();
  },
  async tarball(url) {
    return new Uint8Array(await (await get(url)).arrayBuffer());
  },
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {Record<string, any>} pkg parsed root package.json
 * @param {typeof defaultFetchers} fetchers
 * @returns {Promise<{ pin: string, sha256: string }>} throws with the reason it is not certified
 */
export async function checkCertKernel(pkg, fetchers = defaultFetchers) {
  const pin = pkg?.devDependencies?.[KERNEL];
  if (typeof pin !== 'string' || !EXACT.test(pin)) {
    throw new Error(`devDependencies["${KERNEL}"] = ${JSON.stringify(pin)} is not an exact version`);
  }
  const tag = `v${pin}`;
  let release;
  try {
    release = await fetchers.release(tag);
  } catch (e) {
    throw new Error(`${KERNEL}@${pin}: cannot read release ${REPO} ${tag}: ${e.message}`);
  }
  if (!release || typeof release.body !== 'string' || release.draft || release.tag_name !== tag) {
    throw new Error(`${KERNEL}@${pin}: release ${REPO} ${tag} is missing, a draft, or has no body`);
  }
  const line = new RegExp(`^certified ${escape(KERNEL)}@${escape(pin)} sha256=([0-9a-f]{64})(?:\\s|$)`, 'gm');
  const shas = new Set([...release.body.matchAll(line)].map((m) => m[1]));
  if (shas.size === 0) {
    throw new Error(`${KERNEL}@${pin} is not certified: release ${REPO} ${tag} has no "certified ${KERNEL}@${pin} sha256=<hex>" line`);
  }
  if (shas.size > 1) throw new Error(`${KERNEL}@${pin}: release ${REPO} ${tag} has conflicting certified sha256 lines`);
  const [cert] = shas;
  let got;
  try {
    const manifest = await fetchers.manifest(pin);
    const url = manifest?.dist?.tarball;
    if (manifest?.version !== pin || typeof url !== 'string' || !url.startsWith(REGISTRY)) {
      throw new Error(`registry manifest has no ${REGISTRY} tarball for ${pin}`);
    }
    const bytes = await fetchers.tarball(url);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error(`empty tarball ${url}`);
    got = createHash('sha256').update(bytes).digest('hex');
  } catch (e) {
    throw new Error(`${KERNEL}@${pin}: cannot re-hash the registry tarball: ${e.message}`);
  }
  if (got !== cert) throw new Error(`${KERNEL}@${pin}: registry tarball sha256=${got} does not match the certified sha256=${cert}`);
  return { pin, sha256: cert };
}

async function main() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const { pin, sha256 } = await checkCertKernel(pkg);
    console.log(`check-cert-kernel: ${KERNEL}@${pin} is certified, sha256=${sha256}`);
  } catch (e) {
    console.log(`::error::check-cert-kernel: ${e.message}. Pin the cert kernel in package.json to a certified version.`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
