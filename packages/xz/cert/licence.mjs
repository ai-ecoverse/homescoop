/**
 * xz licences (homescoop#511): every SPDX-License-Identifier in the tarball
 * is in package.json's license expression, and package/LICENSE carries its
 * text. The xzgrep / xzdiff / xzless scripts are GPL-2.0-or-later (adapted
 * from GNU gzip), liblzma and xz 0BSD; 5.8.4-1 shipped only upstream's
 * COPYING summary and said "0BSD".
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

/** Regular files of an npm tarball: name → bytes. */
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
    if (type === '0' || type === '\0') out.set(name, buf.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// A line of each licence's own text, as upstream's COPYING.* has it.
const TEXT = {
  '0BSD': 'Permission to use, copy, modify, and/or distribute this\nsoftware for any purpose with or without fee is hereby granted.',
  'GPL-2.0-or-later': 'GNU GENERAL PUBLIC LICENSE\n                       Version 2, June 1991',
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const all = files(tarball());
  const pkg = JSON.parse(all.get('package/package.json').toString('utf8'));
  const declared = new Set(String(pkg.license).split(/\s+(?:AND|OR)\s+|[()]/).map((s) => s.trim()).filter(Boolean));
  const ids = new Map();
  for (const [name, data] of all) {
    for (const m of data.toString('latin1').matchAll(/SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/g)) {
      if (!ids.has(m[1])) ids.set(m[1], []);
      ids.get(m[1]).push(name);
    }
  }
  assert.deepEqual([...ids.keys()].sort(), ['0BSD', 'GPL-2.0-or-later'], `SPDX identifiers in the tarball: ${JSON.stringify(Object.fromEntries(ids))}`);
  assert.deepEqual(ids.get('GPL-2.0-or-later').sort(), ['package/bin/xzdiff', 'package/bin/xzgrep', 'package/bin/xzless'], 'the GPL-2.0-or-later files');
  const licence = all.get('package/LICENSE')?.toString('utf8') ?? '';
  for (const [id, where] of ids) {
    assert.ok(declared.has(id), `${id} (${where.join(', ')}) is not in package.json's license "${pkg.license}"`);
    assert.ok(TEXT[id], `no known text for ${id}`);
    assert.ok(licence.includes(TEXT[id]), `package/LICENSE has no ${id} text (${where.length} files: ${where.slice(0, 3).join(', ')})`);
  }
  assert.ok(licence.includes('XZ Utils Licensing'), "package/LICENSE has upstream's COPYING summary");
  // The scripts are what the package ships under the GPL: they are there and executable.
  const r = await run(['xz', '--version'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `xz --version: ${r.stderr}`);
  assert.match(r.stdout, /^xz \(XZ Utils\) 5\.8\.4\n/, r.stdout);
  console.log(`licence: ${pkg.license}; SPDX ids ${[...ids].map(([id, w]) => `${id} ×${w.length}`).join(', ')}; LICENSE has both texts`);
}
