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
 * Exit 2  — refuse (also when the version sorts below the version under
 *           its --tag: the publish uses --tag <tag>, so it would move that
 *           tag back; #891, when the version is on npm with other contents,
 *           so these bytes would never ship; #971, and when --tag is not
 *           latest but npm has no latest yet, since the first publish of a
 *           name becomes latest whatever its tag)
 *
 * --tag is the recipe's npm-tag (scripts/npm-tag.mjs), default latest.
 * Versions under other dist-tags never count.
 *
 *   node scripts/assert-certified-publish.mjs <tgz> --npm <name> [--tag <npm-tag>] --certified <sha256>
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compareVersions, packPublished } from './npm-parity.mjs';
import { compareTarballs, describe } from './tarball-parity.mjs';
import { DEFAULT_TAG, cliTagProblem } from './npm-tag.mjs';

const tgz = process.argv[2];
if (!tgz || tgz.startsWith('-')) {
  console.error(
    'usage: assert-certified-publish.mjs <tgz> --npm <name> [--tag <npm-tag>] [--certified <sha256>]',
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

const tag = flag('--tag') || DEFAULT_TAG;
if (cliTagProblem(tag)) {
  console.error(`assert-certified-publish: --tag ${tag}: ${cliTagProblem(tag)}`);
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

async function distTag(t) {
  const url = `${registry}/${encodeURIComponent(npmName)}/${t}`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`GET ${url} -> ${r.status}`);
  const v = (await r.json().catch(() => null))?.version;
  if (typeof v !== 'string') throw new Error(`GET ${url} has no version`);
  return v;
}

let current = null;
try {
  current = await distTag(tag);
  if (tag !== DEFAULT_TAG && !(await distTag(DEFAULT_TAG))) {
    console.error(
      `refuse OIDC publish of ${npmName}@${version} under --tag ${tag}: npm has no latest for ${npmName}, ` +
        `and the first publish of a name becomes latest whatever its tag. Publish the name under latest first.`,
    );
    console.log('certified-publish: FAIL refused');
    process.exit(2);
  }
} catch (err) {
  console.error(`assert-certified-publish: ${err.message}`);
  console.log('certified-publish: FAIL refused');
  process.exit(2);
}
if (current && compareVersions(version, current) < 0) {
  console.error(
    `refuse OIDC publish of ${npmName}@${version}: it sorts below npm ${tag} ${current}, ` +
      `and --tag ${tag} would move ${tag} back. Main published past this build after it was certified; ` +
      `bump the packaging revision above ${current} (homescoop#891).`,
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

console.log(`certified sha256 matches — allow first publish of ${npmName}@${version} under --tag ${tag}`);
console.log(`certified-publish: PASS ${npmName}@${version} --tag ${tag}`);
process.exit(0);
