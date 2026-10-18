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
  console.log(`zip: unzip of non-UTF-8 names exits ${ex.status} and names each refused entry (Illegal byte sequence); nothing is written under another name; the valid entry extracts`);
}
