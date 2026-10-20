#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXACT } from './check-exact-pins.mjs';
import { checkProvenance } from './cert-review/repack-input.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = '@ai-ecoverse/slicc-kernel';
const REPO = 'ai-ecoverse/slicc-kernel';
const REPO_URL = `https://github.com/${REPO}`;
const WORKFLOW = '.github/workflows/release.yml';
const MAIN = 'refs/heads/main';
const REGISTRY = 'https://registry.npmjs.org/';
const TIMEOUT_MS = 120_000;

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.json();
}

const enc = (name) => name.replace('/', '%2f');

export const defaultFetchers = {
  manifest: (version) => get(`${REGISTRY}${enc(KERNEL)}/${encodeURIComponent(version)}`),
  attestations: (version) => get(`${REGISTRY}-/npm/v1/attestations/${enc(KERNEL)}@${encodeURIComponent(version)}`),
  async compare(commit) {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return get(`https://api.github.com/repos/${REPO}/compare/${commit}...main`, headers);
  },
};

/**
 * @param {Record<string, any>} pkg parsed root package.json
 * @param {typeof defaultFetchers} fetchers
 * @returns {Promise<{ pin: string, integrity: string, commit: string, run: string }>} throws with the reason it fails
 */
export async function checkCertKernel(pkg, fetchers = defaultFetchers) {
  const pin = pkg?.devDependencies?.[KERNEL];
  if (typeof pin !== 'string' || !EXACT.test(pin)) {
    throw new Error(`devDependencies["${KERNEL}"] = ${JSON.stringify(pin)} is not an exact version`);
  }
  let manifest;
  try {
    manifest = await fetchers.manifest(pin);
  } catch (e) {
    throw new Error(`${KERNEL}@${pin}: cannot read the registry manifest: ${e.message}`);
  }
  const integrity = manifest?.dist?.integrity;
  if (manifest?.version !== pin || typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`${KERNEL}@${pin}: the registry manifest has no sha512 dist.integrity for ${pin}`);
  }
  let doc;
  try {
    doc = await fetchers.attestations(pin);
  } catch (e) {
    throw new Error(`${KERNEL}@${pin}: cannot read its npm attestations: ${e.message}`);
  }
  const prov = checkProvenance(doc, { npm: KERNEL, version: pin, integrity, repo: REPO_URL, workflows: [WORKFLOW], ref: MAIN, hosted: true });
  if (!prov.ok) throw new Error(`${KERNEL}@${pin} has no valid provenance: ${prov.reason}`);
  let cmp;
  try {
    cmp = await fetchers.compare(prov.commit);
  } catch (e) {
    throw new Error(`${KERNEL}@${pin}: cannot check that commit ${prov.commit} is on ${REPO} main: ${e.message}`);
  }
  if (!['ahead', 'identical'].includes(cmp?.status) || cmp?.merge_base_commit?.sha !== prov.commit) {
    throw new Error(`${KERNEL}@${pin}: provenance commit ${prov.commit} is not on ${REPO} main (compare: ${cmp?.status || 'no status'})`);
  }
  return { pin, integrity, commit: prov.commit, run: prov.run || '' };
}

async function main() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const { pin, integrity, commit, run } = await checkCertKernel(pkg);
    console.log(`check-cert-kernel: PASS ${KERNEL}@${pin} was built by ${REPO} ${WORKFLOW} on main from ${commit} (on main), GitHub-hosted, ${run}; npm provenance covers ${integrity}`);
  } catch (e) {
    console.log(`::error::check-cert-kernel: FAIL ${e.message}. Pin the cert kernel in package.json to a slicc-kernel release published from main.`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
