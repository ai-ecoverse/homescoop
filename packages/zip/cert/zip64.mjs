import { HOME, USER, storedZip, writeBytes } from './lib/zipkit.mjs';

export default async function zip64(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const u8 = (s) => Buffer.from(s);
  const cwd = `${HOME}/z64`;
  await ctx.run(['mkdir', '-p', cwd], { cwd: HOME, user: USER });
  for (const totalDisks of [0, 1]) {
    const file = `win${totalDisks}.zip`;
    await writeBytes(ctx, `${cwd}/${file}`, storedZip([{ name: u8('w.txt'), data: u8('windows\n') }], { zip64Eocd: { totalDisks } }));
    const t = await ctx.run(['unzip', '-t', file], { cwd, user: USER });
    assert.equal(t.status, 0, `unzip -t of a zip64 archive whose locator says ${totalDisks} total disks: rc ${t.status}\n${t.stdout}${t.stderr}`);
    assert.match(t.stdout, /No errors detected/);
    const p = await ctx.run(['unzip', '-p', file, 'w.txt'], { cwd, user: USER });
    assert.equal(p.stdout, 'windows\n', `unzip -p ${file}: ${p.stderr}`);
  }
  const named = storedZip([
    { name: u8('first.txt'), data: u8('1\n') },
    { name: u8('second.txt'), data: u8('2\n') },
    { name: u8('alias.txt'), data: u8('2\n'), sameAs: 'second.txt' },
  ]);
  const at = named.indexOf(Buffer.from('second.txt'));
  const cd = named.lastIndexOf(Buffer.from('alias.txt'));
  assert.equal(named.readUInt32LE(cd - 46 + 42), at - 30, 'zipkit sameAs by name points at that entry\'s local header (homescoop#661)');
  console.log('zip64: a Windows zip64 archive (locator total disks 0) and a standard one (1) both test clean and extract; zipkit sameAs resolves by entry');
}
