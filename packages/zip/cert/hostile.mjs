// homescoop#582: unzip on malformed archives, with Debian unzip 6.0-31's
// security patches (unzip-debian-*.patch) and unipath-short. Each case is
// named by its CVE (or patch) and the safe outcome. As cone, users enforce.
import { HOME, USER, storedZip, writeBytes } from './lib/zipkit.mjs';

export default async function hostile(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const u8 = (s) => Buffer.from(s);
  const cwd = `${HOME}/hz`;
  await ctx.run(['mkdir', '-p', cwd], { cwd: HOME, user: USER });
  const unzip = (...argv) => ctx.run(['unzip', ...argv], { cwd, user: USER });
  const cat = async (path) => (await ctx.run(['cat', path], { cwd, user: USER })).stdout;
  const clean = (r, what) => assert.doesNotMatch(r.stdout + r.stderr, /RuntimeError|Aborted/, `${what}: no wasm trap`);

  // CVE-2019-13232: refuses overlapped entries, rc 12, and writes only the first.
  await writeBytes(ctx, `${cwd}/overlap.zip`, storedZip([
    { name: u8('a.txt'), data: u8('a\n') },
    { name: u8('b.txt'), data: u8('a\n'), sameAs: 0 },
  ]));
  const ov = await unzip('-o', '-d', 'ov', 'overlap.zip');
  assert.equal(ov.status, 12, `CVE-2019-13232 overlapped entries: rc ${ov.status}\n${ov.stdout}${ov.stderr}`);
  assert.match(ov.stdout + ov.stderr, /invalid zip file with overlapped components \(possible zip bomb\)/);
  assert.equal(await cat('ov/a.txt'), 'a\n');
  assert.equal((await ctx.run(['ls', 'ov/b.txt'], { cwd, user: USER })).status, 2, 'CVE-2019-13232: b.txt is not written');

  // CVE-2019-13232 follow-up (misplaced central directory): bytes before the
  // archive are still only a warning, rc 1, not a zip bomb.
  await writeBytes(ctx, `${cwd}/prefixed.zip`, Buffer.concat([Buffer.alloc(100, 0x23), storedZip([{ name: u8('p.txt'), data: u8('p\n') }])]));
  const pf = await unzip('-o', '-d', 'pf', 'prefixed.zip');
  assert.equal(pf.status, 1, `prefixed archive: rc ${pf.status}\n${pf.stdout}${pf.stderr}`);
  assert.match(pf.stdout + pf.stderr, /100 extra bytes at beginning or within zipfile/);
  assert.equal(await cat('pf/p.txt'), 'p\n');

  // unipath-short: Unicode Path fields of 0 and 3 bytes are skipped, so the
  // entries keep their stored names, with no Unicode Path warning.
  const up = (len) => { const b = Buffer.alloc(4 + len); b.writeUInt16LE(0x7075, 0); b.writeUInt16LE(len, 2); return b; };
  await writeBytes(ctx, `${cwd}/upshort.zip`, storedZip([
    { name: u8('u0.txt'), data: u8('0\n'), extra: up(0) },
    { name: u8('u3.txt'), data: u8('3\n'), extra: up(3) },
  ]));
  const ul = await unzip('-l', 'upshort.zip');
  assert.equal(ul.status, 0, `short Unicode Path, unzip -l: rc ${ul.status}\n${ul.stdout}${ul.stderr}`);
  const ud = await unzip('-o', '-d', 'up', 'upshort.zip');
  assert.equal(ud.status, 0, `short Unicode Path, unzip -d: rc ${ud.status}\n${ud.stdout}${ud.stderr}`);
  for (const r of [ul, ud]) assert.doesNotMatch(r.stdout + r.stderr, /Unicode Path/, 'short Unicode Path: no Unicode Path warning');
  assert.equal(await cat('up/u0.txt'), '0\n');
  assert.equal(await cat('up/u3.txt'), '3\n');

  // CVE-2014-9913 (unzip -v) and CVE-2016-9844 (zipinfo): an unknown method
  // number above 999 is listed in its 4-digit hex form, rc 0.
  await writeBytes(ctx, `${cwd}/method.zip`, storedZip([
    { name: u8('m.txt'), data: u8('m\n'), method: 0xffff },
    { name: u8('k.txt'), data: u8('k\n') },
  ]));
  const mv = await unzip('-v', 'method.zip');
  assert.equal(mv.status, 0, `CVE-2014-9913 unzip -v: rc ${mv.status}\n${mv.stdout}${mv.stderr}`);
  assert.match(mv.stdout, /^ +2 +UnkFFFF +2 +0% .* m\.txt$/m, 'CVE-2014-9913: unzip -v lists method UnkFFFF');
  const mz = await unzip('-Z', 'method.zip');
  assert.equal(mz.status, 0, `CVE-2016-9844 unzip -Z: rc ${mz.status}\n${mz.stdout}${mz.stderr}`);
  assert.match(mz.stdout, /^-rw-r--r-- {2}3\.0 unx {8}2 b- FFFF 26-Jan-01 00:00 m\.txt$/m, 'CVE-2016-9844: unzip -Z lists method FFFF');
  for (const r of [mv, mz]) clean(r, 'unknown method');

  // allow-greater-hostver-values (Debian 08): "version made by" 10.0 is
  // listed in the version column, rc 0.
  await writeBytes(ctx, `${cwd}/hostver.zip`, storedZip([{ name: u8('h.txt'), data: u8('h\n'), madeBy: (3 << 8) | 100 }]));
  const hv = await unzip('-Z', 'hostver.zip');
  assert.equal(hv.status, 0, `hostver 10.0: rc ${hv.status}\n${hv.stdout}${hv.stderr}`);
  assert.match(hv.stdout, /^-rw-r--r-- 10\.0 unx {8}2 b- stor 26-Jan-01 00:00 h\.txt$/m, 'hostver 10.0: unzip -Z version column');

  // CVE-2014-8141: a Zip64 extra field too short for the sizes it must hold
  // is reported corrupt (rc 1 for -l); the header's sizes stand, and
  // extraction stops (rc 12).
  const z64 = Buffer.alloc(4);
  z64.writeUInt16LE(0x0001, 0);
  await writeBytes(ctx, `${cwd}/zip64short.zip`, storedZip([
    { name: u8('z.txt'), data: u8('z\n'), csize: 0xffffffff, usize: 0xffffffff, extra: z64 },
    { name: u8('k.txt'), data: u8('k\n') },
  ]));
  const zl = await unzip('-l', 'zip64short.zip');
  assert.equal(zl.status, 1, `CVE-2014-8141 unzip -l: rc ${zl.status}\n${zl.stdout}${zl.stderr}`);
  assert.match(zl.stdout + zl.stderr, /warning: {2}extra field \(type: 0x0001\) corrupt\. {2}Continuing\.\.\./);
  assert.match(zl.stdout, /^4294967295 +01-01-2026 00:00 +z\.txt$/m, 'CVE-2014-8141: the header size stands');
  const zd = await unzip('-o', '-d', 'z64', 'zip64short.zip');
  assert.equal(zd.status, 12, `CVE-2014-8141 unzip -d: rc ${zd.status}\n${zd.stdout}${zd.stderr}`);
  for (const r of [zl, zd]) clean(r, 'CVE-2014-8141');

  // fix-integer-underflow-csiz-decrypted (Debian 16, with CVE-2015-7696's 14):
  // an encrypted entry smaller than its encryption header is invalid data, rc 2.
  await writeBytes(ctx, `${cwd}/encshort.zip`, storedZip([
    { name: u8('e.txt'), data: u8('e\n'), flags: 1 },
    { name: u8('k.txt'), data: u8('k\n') },
  ]));
  for (const mode of ['-t', '-d']) {
    const r = await unzip('-P', 'pw', '-o', ...(mode === '-d' ? ['-d', 'enc'] : ['-t']), 'encshort.zip');
    assert.equal(r.status, 2, `encrypted entry (Debian 16) unzip ${mode}: rc ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /error: {2}invalid compressed data to inflate/);
    assert.doesNotMatch(r.stdout + r.stderr, /csize 1844674407370955/, `encrypted entry (Debian 16) unzip ${mode}: no wrapped size`);
    clean(r, 'encrypted entry (Debian 16)');
  }
}
