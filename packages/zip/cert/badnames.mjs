import { HOME, USER, sh, storedZip, writeBytes } from './lib/zipkit.mjs';

export default async function badnames(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const b = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
  const zip = storedZip([
    { name: b('rep', [0xff], '1.txt'), data: Buffer.from('one\n') },
    { name: b('rep', [0xfe], '2.txt'), data: Buffer.from('two\n') },
    { name: b('caf', [0xe9], '.txt'), data: Buffer.from('latin1\n') },
    { name: b('n', [0xff, 0xc0, 0x80, 0xed, 0xa0, 0x80], '.t'), data: Buffer.from('bit11\n'), flags: 0x800 },
    { name: b('ok.txt'), data: Buffer.from('ok\n') },
  ]);
  await sh(ctx, 'mkdir -p bad');
  await writeBytes(ctx, `${HOME}/bad/b.zip`, zip);
  const cwd = `${HOME}/bad`;
  const ex = await ctx.run(['unzip', '-o', '-d', 'out', 'b.zip'], { cwd, user: USER });
  const out = `${ex.stdout}${ex.stderr}`;
  const ok = await ctx.run(['cat', 'out/ok.txt'], { cwd, user: USER });
  assert.equal(ok.stdout, 'ok\n', `the valid entry is extracted: ${out}`);
  const ls = await ctx.run(['ls', '-1A', 'out'], { cwd, user: USER });
  assert.equal(ls.status, 0, ls.stderr);
  const names = ls.stdout.split('\n').filter(Boolean);
  if (ex.status === 0) {
    assert.equal(names.length, 5, `rc 0 means every entry kept its own name: ${JSON.stringify(names)}\n${out}`);
    assert.ok(!names.some((n) => n === 'rep1.txt' || n === 'n' || n.includes('\ufffd')), `rc 0, but an entry was written under another name: ${JSON.stringify(names)}\n${out}`);
    return;
  }
  assert.notEqual(ex.status, 0);
  assert.deepEqual(names, ['ok.txt'], `no entry was written under another name: ${JSON.stringify(names)}\n${out}`);
  for (const stem of ['rep', 'caf', 'n']) assert.match(out, new RegExp(`cannot create out/${stem}`), `unzip names the entry it refused (${stem}…): ${out}`);
  assert.match(out, /Illegal byte sequence/, `the reason is that the name isn't UTF-8: ${out}`);
  const p = await ctx.run(['unzip', '-p', 'b.zip', 'ok.txt'], { cwd, user: USER });
  assert.equal(p.stdout, 'ok\n');

  const run = (argv) => ctx.run(argv, { cwd, user: USER });
  const listing = async (dir) => {
    const r = await run(['ls', '-1A', dir]);
    assert.equal(r.status, 0, `ls ${dir}: ${r.stderr}`);
    return r.stdout.split('\n').filter(Boolean).sort();
  };
  const unescape = (name) => Buffer.concat(name.split(/(%[0-9A-F]{2})/).filter(Boolean).map((part) => (/^%[0-9A-F]{2}$/.test(part) ? Buffer.from([parseInt(part.slice(1), 16)]) : Buffer.from(part))));
  const esc = await run(['unzip', '-o', '-%', '-d', 'esc', 'b.zip']);
  const escOut = `${esc.stdout}${esc.stderr}`;
  assert.equal(esc.status, 0, `unzip -% of the same archive: rc ${esc.status}\n${escOut}`);
  const escaped = { 'rep%FF1.txt': 'one\n', 'rep%FE2.txt': 'two\n', 'caf%E9.txt': 'latin1\n', 'n%FF%C0%80%ED%A0%80.t': 'bit11\n', 'ok.txt': 'ok\n' };
  assert.deepEqual(await listing('esc'), Object.keys(escaped).sort(), `unzip -% writes all five entries under distinct escaped names: ${escOut}`);
  for (const [name, data] of Object.entries(escaped)) {
    const c = await run(['cat', `esc/${name}`]);
    assert.equal(c.stdout, data, `esc/${name} holds its entry's bytes: ${c.stderr}`);
    if (name !== 'ok.txt') assert.match(escOut, new RegExp(`escaped: esc/${name.replace(/[.%]/g, (m) => `\\${m}`)}`), `unzip -% reports ${name} as escaped: ${escOut}`);
  }
  const stored = [b('rep', [0xff], '1.txt'), b('rep', [0xfe], '2.txt'), b('caf', [0xe9], '.txt'), b('n', [0xff, 0xc0, 0x80, 0xed, 0xa0, 0x80], '.t'), b('ok.txt')];
  assert.deepEqual(Object.keys(escaped).map((n) => unescape(n).toString('hex')), stored.map((n) => n.toString('hex')), 'each escaped name reverses to its stored name');
  assert.doesNotMatch(escOut, /escaped: esc\/ok\.txt/, 'a UTF-8 name is not escaped');

  await writeBytes(ctx, `${cwd}/pct.zip`, storedZip([
    { name: b('100%', [0xe9], '.txt'), data: Buffer.from('pct\n') },
    { name: b('50%.txt'), data: Buffer.from('fifty\n') },
  ]));
  const pct = await run(['unzip', '-%', '-d', 'pct', 'pct.zip']);
  assert.equal(pct.status, 0, `unzip -% pct.zip: ${pct.stdout}${pct.stderr}`);
  assert.deepEqual(await listing('pct'), ['100%25%E9.txt', '50%.txt'], 'in an escaped name % is %25; a UTF-8 name with % is left alone');
  assert.equal(unescape('100%25%E9.txt').toString('hex'), b('100%', [0xe9], '.txt').toString('hex'));

  for (const [file, entries, kept] of [
    ['first-escaped.zip', [{ name: b('a', [0xff]), data: Buffer.from('escaped\n') }, { name: b('a%FF'), data: Buffer.from('valid\n') }], 'escaped\n'],
    ['first-valid.zip', [{ name: b('a%FF'), data: Buffer.from('valid\n') }, { name: b('a', [0xff]), data: Buffer.from('escaped\n') }], 'valid\n'],
  ]) {
    await writeBytes(ctx, `${cwd}/${file}`, storedZip(entries));
    const dir = file.replace('.zip', '');
    const r = await run(['unzip', '-o', '-%', '-d', dir, file]);
    const o = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, `${file}: an escaped name that collides with another entry's exits non-zero: ${o}`);
    assert.match(r.stderr, new RegExp(`${dir}/a%FF:.*not extracted`), `${file}: unzip names the refused entry: ${o}`);
    assert.deepEqual(await listing(dir), ['a%FF'], `${file}: one file, no other name: ${o}`);
    const c = await run(['cat', `${dir}/a%FF`]);
    assert.equal(c.stdout, kept, `${file}: the first entry is kept and never overwritten through the mapped name: ${o}`);
  }
  for (const mode of ['-o', '-n']) {
    const dir = `disk${mode}`;
    await sh(ctx, `mkdir -p ${dir} && printf 'mine\\n' > '${dir}/rep%FF1.txt'`, cwd);
    const r = await run(['unzip', mode, '-%', '-d', dir, 'b.zip']);
    const o = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, `unzip ${mode} -%: an escaped name that exists on disk exits non-zero: ${o}`);
    assert.match(r.stderr, /rep%FF1\.txt:.*not extracted/, `unzip ${mode} -% names the refused entry: ${o}`);
    const c = await run(['cat', `${dir}/rep%FF1.txt`]);
    assert.equal(c.stdout, 'mine\n', `unzip ${mode} -% leaves the existing file alone: ${o}`);
  }

  await writeBytes(ctx, `${cwd}/dirs.zip`, storedZip([
    { name: b('d', [0xff], '/x.txt'), data: Buffer.from('x\n') },
    { name: b('lnk'), data: b('t', [0xe9]), external: (0o120777 << 16) >>> 0 },
    { name: b('ok.txt'), data: Buffer.from('ok\n') },
  ]));
  const dirs = await run(['unzip', '-o', '-d', 'dirs', 'dirs.zip']);
  const dirsOut = `${dirs.stdout}${dirs.stderr}`;
  assert.notEqual(dirs.status, 0, `a directory component that isn't UTF-8 is refused: ${dirsOut}`);
  assert.deepEqual(await listing('dirs'), ['ok.txt'], `no d/ and no lnk: ${dirsOut}`);
  assert.match(dirsOut, /checkdir error:.*cannot create dirs\/d/, `unzip names the directory it refused: ${dirsOut}`);
  assert.match(dirsOut, /symlink error: Illegal byte sequence/, `a symlink target that isn't UTF-8 is refused: ${dirsOut}`);
  const junk = await run(['unzip', '-o', '-j', '-d', 'junk', 'dirs.zip']);
  assert.equal((await run(['cat', 'junk/x.txt'])).stdout, 'x\n', `unzip -j still extracts x.txt: ${junk.stdout}${junk.stderr}`);
  const escDirs = await run(['unzip', '-o', '-%', '-d', 'escdirs', 'dirs.zip']);
  const escDirsOut = `${escDirs.stdout}${escDirs.stderr}`;
  assert.equal((await run(['cat', 'escdirs/d%FF/x.txt'])).stdout, 'x\n', `unzip -% escapes the directory component: ${escDirsOut}`);
  assert.deepEqual(await listing('escdirs'), ['d%FF', 'ok.txt'], `unzip -% escapes names, not symlink targets: lnk is still refused: ${escDirsOut}`);
  console.log(`zip: unzip of non-UTF-8 names exits ${ex.status} and names each refused entry (Illegal byte sequence), also a directory component and a symlink target; nothing is written under another name; with -% each is written under a reversible %XX name, and an escaped name that collides with an entry or a file is refused, never overwriting`);
}
