#!/usr/bin/env node
/**
 * Gate ladder-build OIDC publish.
 *
 * A version that is not yet on npm may be published from CI only when
 * `certified` is a 64-char sha256 that matches the built tarball.
 * Land-before-publish therefore cannot ship an uncertified rebuild.
 *
 * Exit 0  — hashes match; caller may `npm publish`
 * Exit 10 — the version is already on npm with these contents; skip publish
 *           (the same entries, not necessarily the same bytes: npm-parity's rule)
 * Exit 2  — refuse (also when the version sorts below npm's latest: the
 *           publish uses --tag latest, so it would move latest back; #891,
 *           and when the version is on npm with other contents, so these
 *           bytes would never ship; #971)
 *
 *   node scripts/assert-certified-publish.mjs <tgz> --npm <name> --certified <sha256>
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compareVersions, packPublished } from './npm-parity.mjs';
import { compareTarballs, describe } from './tarball-parity.mjs';

const tgz = process.argv[2];
if (!tgz || tgz.startsWith('-')) {
  console.error(
    'usage: assert-certified-publish.mjs <tgz> --npm <name> [--certified <sha256>]',
  );
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

const npmName = flag('--npm');
const certified = (flag('--certified') || process.env.CERTIFIED || '')
  .trim()
  .toLowerCase();

if (!npmName) {
  console.error('assert-certified-publish: --npm is required');
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

const buf = readFileSync(tgz);
const sha256 = createHash('sha256').update(buf).digest('hex');
console.log(`tarball sha256 ${sha256}`);

const pkgJson = execFileSync('tar', ['-xOf', tgz, 'package/package.json'], {
  encoding: 'utf8',
});
const { name, version } = JSON.parse(pkgJson);
if (name !== npmName) {
  console.error(
    `assert-certified-publish: tarball name ${name} != --npm ${npmName}`,
  );
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

const registry = process.env.HOMESCOOP_REGISTRY || 'https://registry.npmjs.org';
const url = `${registry}/${encodeURIComponent(npmName)}/${version}`;
const res = await fetch(url);
if (res.status === 200) {
  const integrity = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
  const doc = await res.json().catch(() => null);
  if (doc?.dist?.integrity === integrity) {
    console.log(`already on npm: ${npmName}@${version}, byte-identical — skip publish`);
    console.log(`certified-publish: FAIL ${npmName}@${version} is already on npm: nothing to publish (exit 10, skip)`);
    process.exit(10);
  }
  let cmp;
  try {
    cmp = compareTarballs(packPublished(`${npmName}@${version}`), buf, { labels: ['npm', 'build'] });
  } catch (err) {
    console.error(`assert-certified-publish: ${npmName}@${version} is on npm, and comparing it failed: ${err.message}`);
    console.log('certified-publish: FAIL refused');
    process.exit(2);
  }
  if (cmp.same) {
    console.log(`already on npm: ${npmName}@${version}, same contents — skip publish`);
    console.log(`certified-publish: FAIL ${npmName}@${version} is already on npm: nothing to publish (exit 10, skip)`);
    process.exit(10);
  }
  console.error(
    `refuse: ${npmName}@${version} is already on npm with different contents (${cmp.diffs.length} entr${cmp.diffs.length === 1 ? 'y' : 'ies'}), ` +
      `so these bytes would never ship. Bump the packaging revision (homescoop#971).`,
  );
  for (const line of describe(cmp, { max: 20 })) console.error(line);
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}
if (res.status !== 404) {
  console.error(`assert-certified-publish: GET ${url} -> ${res.status}`);
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

const latestUrl = `${registry}/${encodeURIComponent(npmName)}/latest`;
const tags = await fetch(latestUrl);
let latest = null;
if (tags.status === 200) {
  latest = (await tags.json().catch(() => null))?.version;
  if (typeof latest !== 'string') {
    console.error(`assert-certified-publish: GET ${latestUrl} has no version`);
    console.log('certified-publish: FAIL refused');
    process.exit(2);
  }
} else if (tags.status !== 404) {
  console.error(`assert-certified-publish: GET ${latestUrl} -> ${tags.status}`);
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}
if (latest && compareVersions(version, latest) < 0) {
  console.error(
    `refuse OIDC publish of ${npmName}@${version}: it sorts below npm latest ${latest}, ` +
      `and --tag latest would move latest back. Main published past this build after it was certified; ` +
      `bump the packaging revision above ${latest} (homescoop#891).`,
  );
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

if (!/^[0-9a-f]{64}$/.test(certified)) {
  console.error(
    `refuse OIDC publish of unpublished ${npmName}@${version}: ` +
      `dispatch certified=<sha256> matching the built tarball ` +
      `(got ${certified ? 'invalid certified input' : 'empty certified'}). ` +
      `Publish the certified tarball from a laptop first, then land.`,
  );
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

if (certified !== sha256) {
  console.error(
    `refuse OIDC publish of ${npmName}@${version}: ` +
      `certified=${certified} != tarball sha256=${sha256}`,
  );
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}

console.log(`certified sha256 matches — allow first publish of ${npmName}@${version}`);
console.log(`certified-publish: PASS ${npmName}@${version}`);
process.exit(0);
