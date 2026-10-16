// homescoop#431: non-ASCII (UTF-8) names, both ways, as cone (users enforce).
import { HOME, USER, localHeaders, readBytes, sh, storedZip, unicodePathExtra, writeBytes } from './lib/zipkit.mjs';

export default async function utf8(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const u8 = (s) => Buffer.from(s, 'utf8');
  // A host-made archive: two names with the UTF-8 flag (general purpose bit
  // 11, as Python's zipfile and macOS write them), and a CP437 name ("na" 0x8b
  // "ve.txt") with Info-ZIP's Unicode Path extra field, as Windows zips carry.
  const cp437 = Buffer.from([0x6e, 0x61, 0x8b, 0x76, 0x65, 0x2e, 0x74, 0x78, 0x74]);
  const zip = storedZip([
    { name: u8('café.txt'), data: u8('y\n'), flags: 0x800 },
    { name: u8('ünï/名前.txt'), data: u8('x\n'), flags: 0x800 },
    { name: cp437, data: u8('n\n'), extra: unicodePathExtra(cp437, u8('naïve.txt')) },
    { name: u8('plain.txt'), data: u8('z\n') },
  ]);
  await sh(ctx, 'mkdir -p u8');
  await writeBytes(ctx, `${HOME}/u8/u.zip`, zip);
  const cwd = `${HOME}/u8`;
  const list = await ctx.run(['unzip', '-l', 'u.zip'], { cwd, user: USER });
  assert.equal(list.status, 0, list.stdout + list.stderr);
  for (const name of ['café.txt', 'ünï/名前.txt', 'naïve.txt', 'plain.txt']) {
    assert.match(list.stdout, new RegExp(`\\s${name.replace(/\./g, '\\.')}\\n`), `unzip -l shows ${name}`);
  }
  assert.doesNotMatch(list.stdout, /\?/, 'unzip -l shows no ? for a name');
  const ex = await ctx.run(['unzip', '-d', 'out', 'u.zip'], { cwd, user: USER });
  assert.equal(ex.status, 0, `unzip -d: rc ${ex.status}\n${ex.stdout}${ex.stderr}`);
  for (const [name, want] of [['café.txt', 'y\n'], ['ünï/名前.txt', 'x\n'], ['naïve.txt', 'n\n'], ['plain.txt', 'z\n']]) {
    const cat = await ctx.run(['cat', `out/${name}`], { cwd, user: USER });
    assert.equal(cat.status, 0, `out/${name}: ${cat.stderr}`);
    assert.equal(cat.stdout, want, `out/${name} has its bytes`);
  }
  const ls = await ctx.run(['ls', '-1', 'out', 'out/ünï'], { cwd, user: USER });
  assert.equal(ls.status, 0, ls.stderr);
  assert.equal(ls.stdout, 'out:\ncafé.txt\nnaïve.txt\nplain.txt\nünï\n\nout/ünï:\n名前.txt\n');

  // And back: zip -r of UTF-8 names in seven's UTF-8 locale marks them UTF-8,
  // so other readers (Windows, Python, 7-Zip) see the names, not CP437.
  const made = await sh(ctx, "mkdir -p rt/ü && printf 'n\\n' > rt/naïve.txt && printf 'k\\n' > rt/ü/名.txt && cd rt && zip -r ../z.zip naïve.txt ü", cwd);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.match(made.stdout, /adding: naïve\.txt/);
  assert.match(made.stdout, /adding: ü\/名\.txt/);
  const heads = localHeaders(await readBytes(ctx, `${cwd}/z.zip`));
  assert.deepEqual(heads.map((h) => h.name), ['naïve.txt', 'ü/', 'ü/名.txt']);
  for (const h of heads) assert.equal(h.flags & 0x800, 0x800, `${h.name}: UTF-8 flag (bit 11)`);
  const back = await ctx.run(['unzip', '-o', '-d', 'back', 'z.zip'], { cwd, user: USER });
  assert.equal(back.status, 0, back.stdout + back.stderr);
  assert.equal((await ctx.run(['cat', 'back/naïve.txt'], { cwd, user: USER })).stdout, 'n\n');
  assert.equal((await ctx.run(['cat', 'back/ü/名.txt'], { cwd, user: USER })).stdout, 'k\n');
}
