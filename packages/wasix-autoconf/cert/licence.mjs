/**
 * wasix-autoconf licences (homescoop#565): the tarball carries the text of
 * every licence its files name. Autoconf is GPL-3.0-or-later (COPYINGv3),
 * parts of its m4 sources and build-aux scripts carry the Autoconf
 * Configure Script Exception (COPYING.EXCEPTION) or a similar "special
 * exception", and the Autom4te Perl modules are GPL-2.0-or-later (COPYING).
 * Until 2.72.0-8 package/LICENSE was COPYING (GPLv2) alone.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

/** Regular files of an npm tarball: name → text. */
function files(tgz) {
  const buf = gunzipSync(readFileSync(tgz));
  const out = new Map();
  for (let at = 0; at + 512 <= buf.length; ) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const prefix = str(345, 500);
    const name = (prefix ? `${prefix}/` : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 0x30);
    if (type === '0' || type === '\0') out.set(name, buf.subarray(at + 512, at + 512 + size).toString('latin1'));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// What a file's notice says → the text that has to ship with it.
const NOTICES = [
  ['GPLv3', /version 3 of the License/, 'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007'],
  ['GPLv2', /either version 2 of the License|version 2, or \(at your option\)/, 'GNU GENERAL PUBLIC LICENSE\n                       Version 2, June 1991'],
  ['Autoconf exception', /Autoconf Configure Script Exception/, 'AUTOCONF CONFIGURE SCRIPT EXCEPTION\n                       Version 3.0, 18 August 2009'],
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const all = files(tarball());
  const pkg = JSON.parse(all.get('package/package.json'));
  assert.match(String(pkg.license), /^GPL-3\.0-or-later\b/, `package.json license: ${pkg.license}`);
  const licence = all.get('package/LICENSE') ?? '';
  const seen = [];
  for (const [what, notice, text] of NOTICES) {
    const where = [...all].filter(([n, t]) => n !== 'package/LICENSE' && notice.test(t)).map(([n]) => n);
    assert.ok(where.length > 0, `no file names ${what}; the check is stale`);
    assert.ok(licence.includes(text), `package/LICENSE has no ${what} text, which ${where.length} files name (${where.slice(0, 3).join(', ')})`);
    seen.push(`${what} ×${where.length}`);
  }
  for (const f of ['COPYINGv3', 'COPYING.EXCEPTION', 'COPYING']) assert.ok(licence.includes(`==> ${f} <==`), `package/LICENSE has no ${f} section`);
  assert.match(all.get('package/README.md') ?? '', /## Licence/, 'README has no Licence section');
  const r = await run(['autoconf', '--version'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `autoconf --version: rc=${r.status} ${r.stderr}`);
  assert.match(r.stdout, /^autoconf \(GNU Autoconf\) 2\.72\n/, r.stdout);
  assert.match(r.stdout, /License GPLv3\+\/Autoconf: GNU GPL version 3 or later/, r.stdout);
  console.log(`licence: ${pkg.license}; files name ${seen.join(', ')}; LICENSE has COPYINGv3, COPYING.EXCEPTION and COPYING`);
}
