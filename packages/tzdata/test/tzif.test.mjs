// The built package (package/, with the PR's tarball unpacked over it in CI):
// the zones bios and musl need are there, every zone file is a well-formed
// TZif file, backward's aliases are copies of their targets, and the tree is
// the lean one (no right/, posix/ or links). Run: node --test 'test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..', 'package');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const zoneinfo = join(pkgDir, pkg.slicc.zoneinfo);
const TEXT = new Set(['tzdata.zi', 'zone.tab', 'zone1970.tab', 'zonenow.tab', 'iso3166.tab', 'leapseconds']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Parse a TZif file (RFC 9636): the v1 block, then for v2+ the 64-bit block
 * and the footer. Throws on anything malformed; returns what the checks use.
 */
export function parseTzif(buf) {
  const header = (off) => {
    assert.equal(buf.toString('latin1', off, off + 4), 'TZif', 'magic');
    const version = buf[off + 4];
    assert.ok(version === 0 || (version >= 0x32 && version <= 0x34), `version byte ${version}`);
    const n = [];
    for (let i = 0; i < 6; i++) n.push(buf.readUInt32BE(off + 20 + 4 * i));
    const [isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt] = n;
    assert.ok(typecnt >= 1, 'typecnt ≥ 1');
    assert.ok(charcnt >= 1, 'charcnt ≥ 1');
    assert.ok(isutcnt === 0 || isutcnt === typecnt, 'isutcnt is 0 or typecnt');
    assert.ok(isstdcnt === 0 || isstdcnt === typecnt, 'isstdcnt is 0 or typecnt');
    return { version, isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt };
  };
  const blockSize = (h, t) => h.timecnt * t + h.timecnt + h.typecnt * 6 + h.charcnt + h.leapcnt * (t + 4) + h.isstdcnt + h.isutcnt;
  const v1 = header(0);
  let off = 44 + blockSize(v1, 4);
  if (v1.version === 0) {
    assert.equal(off, buf.length, 'a v1 file ends after its block');
    return { version: 1, v1 };
  }
  const h = header(off);
  assert.equal(h.version, v1.version, 'both headers name the same version');
  const data = off + 44;
  const times = [];
  for (let i = 0; i < h.timecnt; i++) times.push(buf.readBigInt64BE(data + 8 * i));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'transition times ascend');
  const idx = data + 8 * h.timecnt;
  for (let i = 0; i < h.timecnt; i++) assert.ok(buf[idx + i] < h.typecnt, 'transition type index in range');
  const types = idx + h.timecnt;
  const chars = types + 6 * h.typecnt;
  const abbrevs = [];
  for (let i = 0; i < h.typecnt; i++) {
    const utoff = buf.readInt32BE(types + 6 * i);
    const isdst = buf[types + 6 * i + 4];
    const ai = buf[types + 6 * i + 5];
    assert.ok(isdst === 0 || isdst === 1, 'isdst is 0 or 1');
    assert.ok(ai < h.charcnt, 'abbreviation index in range');
    const end = buf.indexOf(0, chars + ai);
    assert.ok(end >= 0 && end < chars + h.charcnt, 'abbreviation is NUL-terminated inside the block');
    abbrevs.push({ utoff, isdst, abbr: buf.toString('latin1', chars + ai, end) });
  }
  off = data + blockSize(h, 8);
  assert.equal(buf[off], 0x0a, 'footer starts with a newline');
  assert.equal(buf[buf.length - 1], 0x0a, 'footer ends with a newline');
  const footer = buf.toString('latin1', off + 1, buf.length - 1);
  assert.ok(!footer.includes('\n'), 'one footer line');
  return { version: h.version - 0x30, v1, h, abbrevs, footer, timecnt: h.timecnt };
}

test('package.json names the zoneinfo directory, and it is share/zoneinfo', () => {
  assert.equal(pkg.slicc.zoneinfo, 'share/zoneinfo');
  assert.ok(pkg.files.includes('share'));
  assert.ok(existsSync(zoneinfo), `${zoneinfo} (build the package first: bash build.sh)`);
});

test('Europe/Berlin has CET and CEST and the EU rule in its footer', () => {
  const z = parseTzif(readFileSync(join(zoneinfo, 'Europe/Berlin')));
  assert.ok(z.version >= 2);
  assert.equal(z.footer, 'CET-1CEST,M3.5.0,M10.5.0/3');
  const abbr = new Set(z.abbrevs.map((a) => `${a.abbr}/${a.utoff}/${a.isdst}`));
  assert.ok(abbr.has('CET/3600/0') && abbr.has('CEST/7200/1'), [...abbr].join(' '));
});

test('America/New_York is EST5EDT, and US/Eastern (backward) is the same bytes in its own file', () => {
  const ny = readFileSync(join(zoneinfo, 'America/New_York'));
  assert.equal(parseTzif(ny).footer, 'EST5EDT,M3.2.0,M11.1.0');
  const alias = join(zoneinfo, 'US/Eastern');
  assert.ok(lstatSync(alias).isFile() && lstatSync(alias).nlink === 1, 'US/Eastern is a regular file, not a link');
  assert.deepEqual(readFileSync(alias), ny);
  for (const [old, now] of [['Asia/Calcutta', 'Asia/Kolkata'], ['GB', 'Europe/London'], ['Etc/UTC', 'UTC']]) {
    assert.deepEqual(readFileSync(join(zoneinfo, old)), readFileSync(join(zoneinfo, now)), `${old} = ${now}`);
  }
});

test('UTC and Etc/UTC are UTC0 with no transitions', () => {
  for (const name of ['UTC', 'Etc/UTC']) {
    const z = parseTzif(readFileSync(join(zoneinfo, name)));
    assert.equal(z.footer, 'UTC0', name);
    assert.equal(z.timecnt, 0, name);
    assert.deepEqual(z.abbrevs, [{ utoff: 0, isdst: 0, abbr: 'UTC' }], name);
  }
});

test('every zone file is valid TZif (v2+ with a footer), every file regular, and the tree lean', () => {
  const files = walk(zoneinfo);
  let zones = 0;
  for (const f of files) {
    const rel = relative(zoneinfo, f);
    const st = lstatSync(f);
    assert.ok(st.isFile(), `${rel} is a regular file`);
    assert.equal(st.nlink, 1, `${rel} has no hard links`);
    if (TEXT.has(rel)) continue;
    const z = parseTzif(readFileSync(f));
    assert.ok(z.version >= 2, `${rel} is TZif v2+`);
    zones++;
  }
  assert.ok(zones > 550, `${zones} zone files`);
  for (const d of ['right', 'posix']) assert.ok(!existsSync(join(zoneinfo, d)), `no ${d}/ tree`);
  assert.ok(!existsSync(join(zoneinfo, 'posixrules')) && !existsSync(join(zoneinfo, 'localtime')), 'no posixrules or localtime');
});

test('tzdata.zi is the recipe release, and zone1970.tab lists Europe/Berlin and America/New_York', () => {
  const zi = readFileSync(join(zoneinfo, 'tzdata.zi'), 'utf8');
  assert.equal(zi.split('\n')[0], `# version ${pkg.homescoop.upstream}`);
  assert.match(zi, /^L America\/New_York US\/Eastern$/m, 'tzdata.zi has the backward links');
  const tab = readFileSync(join(zoneinfo, 'zone1970.tab'), 'utf8');
  for (const z of ['Europe/Berlin', 'America/New_York']) assert.match(tab, new RegExp(`\\t${z}(\\t|$)`, 'm'), z);
  for (const f of TEXT) assert.ok(existsSync(join(zoneinfo, f)), f);
});

test('NEGATIVE: the parser rejects a truncated file, a bad magic and a missing footer', () => {
  const good = readFileSync(join(zoneinfo, 'Europe/Berlin'));
  assert.doesNotThrow(() => parseTzif(good));
  assert.throws(() => parseTzif(good.subarray(0, good.length - 5)));
  const magic = Buffer.from(good);
  magic.write('TZiF', 0, 'latin1');
  assert.throws(() => parseTzif(magic), /magic/);
  const nofooter = Buffer.from(good);
  nofooter[nofooter.length - 1] = 0x20;
  assert.throws(() => parseTzif(nofooter), /footer/);
});
