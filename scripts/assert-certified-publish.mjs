#!/usr/bin/env node
/**
 * Gate ladder-build OIDC publish.
 *
 * A version that is not yet on npm may be published from CI only when
 * `certified` is a 64-char sha256 that matches the built tarball.
 * Land-before-publish therefore cannot ship an uncertified rebuild.
 *
 * Exit 0  — hashes match; caller may `npm publish`
 * Exit 10 — version document already exists; skip publish
 * Exit 2  — refuse
 *
 *   node scripts/assert-certified-publish.mjs <tgz> --npm <name> --certified <sha256>
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const tgz = process.argv[2];
if (!tgz || tgz.startsWith('-')) {
  console.error(
    'usage: assert-certified-publish.mjs <tgz> --npm <name> [--certified <sha256>]',
  );
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
  process.exit(2);
}

const url = `https://registry.npmjs.org/${encodeURIComponent(npmName)}/${version}`;
const res = await fetch(url);
if (res.status === 200) {
  console.log(`already on npm: ${npmName}@${version} — skip publish`);
  process.exit(10);
}
if (res.status !== 404) {
  console.error(`assert-certified-publish: GET ${url} -> ${res.status}`);
  process.exit(2);
}

if (!/^[0-9a-f]{64}$/.test(certified)) {
  console.error(
    `refuse OIDC publish of unpublished ${npmName}@${version}: ` +
      `dispatch certified=<sha256> matching the built tarball ` +
      `(got ${certified ? 'invalid certified input' : 'empty certified'}). ` +
      `Publish the certified tarball from a laptop first, then land.`,
  );
  process.exit(2);
}

if (certified !== sha256) {
  console.error(
    `refuse OIDC publish of ${npmName}@${version}: ` +
      `certified=${certified} != tarball sha256=${sha256}`,
  );
  process.exit(2);
}

console.log(`certified sha256 matches — allow first publish of ${npmName}@${version}`);
process.exit(0);
