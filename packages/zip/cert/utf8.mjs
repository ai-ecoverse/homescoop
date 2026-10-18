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
    // homescoop#570: a Unicode Path field that isn't UTF-8 is ignored, and
    // the entry keeps its stored ASCII name.
    { name: u8('n.txt'), data: u8('b\n'), extra: unicodePathExtra(u8('n.txt'), Buffer.from([0xff, 0xc0, 0x80, 0xed, 0xa0, 0x80, 0x2e])) },
  ]);
  await sh(ctx, 'mkdir -p u8');
  await writeBytes(ctx, `${HOME}/u8/u.zip`, zip);
  const cwd = `${HOME}/u8`;
  const list = await ctx.run(['unzip', '-l', 'u.zip'], { cwd, user: USER });
  assert.equal(list.status, 0, list.stdout + list.stderr);
  for (const name of ['café.txt', 'ünï/名前.txt', 'naïve.txt', 'plain.txt', 'n.txt']) {
    assert.match(list.stdout, new RegExp(`\\s${name.replace(/\./g, '\\.')}\\n`), `unzip -l shows ${name}`);
  }
  assert.doesNotMatch(list.stdout, /\?/, 'unzip -l shows no ? for a name');
  const ex = await ctx.run(['unzip', '-d', 'out', 'u.zip'], { cwd, user: USER });
  assert.equal(ex.status, 0, `unzip -d: rc ${ex.status}\n${ex.stdout}${ex.stderr}`);
  for (const [name, want] of [['café.txt', 'y\n'], ['ünï/名前.txt', 'x\n'], ['naïve.txt', 'n\n'], ['plain.txt', 'z\n'], ['n.txt', 'b\n']]) {
    const cat = await ctx.run(['cat', `out/${name}`], { cwd, user: USER });
    assert.equal(cat.status, 0, `out/${name}: ${cat.stderr}`);
    assert.equal(cat.stdout, want, `out/${name} has its bytes`);
  }
  const ls = await ctx.run(['ls', '-1', 'out', 'out/ünï'], { cwd, user: USER });
  assert.equal(ls.status, 0, ls.stderr);
  assert.equal(ls.stdout, 'out:\ncafé.txt\nn.txt\nnaïve.txt\nplain.txt\nünï\n\nout/ünï:\n名前.txt\n');

  // unzip -U escapes every non-ASCII Unicode name (#U/#L), through the
  // conversion code that CVE-2022-0529/0530 are in (homescoop#583). A CP437
  // name with a Unicode Path field that isn't UTF-8 keeps its stored name,
  // which isn't UTF-8 either, so from 3.0.0-7 that entry is refused (rc 50,
  // "Illegal byte sequence") instead of being written under a mangled name
  // (homescoop#602); on 3.0.0-2 both commands trapped (rc 70).
  const cpBad = Buffer.from([0x6e, 0x61, 0x8b, 0x76, 0x65, 0x2e, 0x74, 0x78, 0x74]);
  const esc = storedZip([
    { name: cpBad, data: u8('c\n'), extra: unicodePathExtra(cpBad, Buffer.from([0xff, 0xc0, 0x80, 0xed, 0xa0, 0x80, 0x2e])) },
    { name: u8('e.txt'), data: u8('e\n'), extra: unicodePathExtra(u8('e.txt'), u8('😀.txt')) },
    { name: u8('café.txt'), data: u8('y\n'), flags: 0x800 },
  ]);
  await writeBytes(ctx, `${cwd}/esc.zip`, esc);
  const ul = await ctx.run(['unzip', '-U', '-l', 'esc.zip'], { cwd, user: USER });
  assert.equal(ul.status, 0, `unzip -U -l: rc ${ul.status}\n${ul.stdout}${ul.stderr}`);
  assert.doesNotMatch(ul.stdout + ul.stderr, /RuntimeError/);
  assert.match(ul.stdout, /\s#L01f600\.txt\n/, 'unzip -U -l escapes 😀.txt');
  assert.match(ul.stdout, /\s3 files\n/);
  const ud = await ctx.run(['unzip', '-U', '-d', 'esc', 'esc.zip'], { cwd, user: USER });
  assert.equal(ud.status, 50, `unzip -U -d: rc ${ud.status}\n${ud.stdout}${ud.stderr}`);
  assert.doesNotMatch(ud.stdout + ud.stderr, /RuntimeError/);
  assert.match(ud.stdout + ud.stderr, /cannot create esc\/na[^\n]*ve\.txt\n\s*Illegal byte sequence/, 'the CP437 entry is refused by name');
  assert.equal((await ctx.run(['cat', 'esc/#L01f600.txt'], { cwd, user: USER })).stdout, 'e\n');
  assert.equal((await ctx.run(['cat', 'esc/café.txt'], { cwd, user: USER })).stdout, 'y\n');
  const cp = await ctx.run(['ls', '-1A', 'esc'], { cwd, user: USER });
  assert.equal(cp.stdout, '#L01f600.txt\ncafé.txt\n', 'nothing is written under a mangled name');

  // A bit-11 name of 5- and 6-byte sequences (legacy UTF-8, which unzip
  // still decodes): each is a 31-bit value, a 10-byte "#L7fffffff" under -U.
  // 3.0.0-3 sized 8 bytes per escape and appended with strcat(): the heap
  // overflowed and unzip trapped (homescoop#579's Codex P1).
  const six = Buffer.from([0xfd, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf]);
  const long = storedZip([
    { name: Buffer.concat([u8('w'), ...Array(24).fill(six), u8('.txt')]), data: u8('w\n'), flags: 0x800, extra: Buffer.from([0xfe, 0xca, 0, 0]) },
    { name: u8('ok.txt'), data: u8('k\n') },
  ]);
  await writeBytes(ctx, `${cwd}/six.zip`, long);
  const escaped = `w${'#L7fffffff'.repeat(24)}.txt`;
  const sl = await ctx.run(['unzip', '-U', '-l', 'six.zip'], { cwd, user: USER });
  assert.equal(sl.status, 0, `unzip -U -l six.zip: rc ${sl.status}\n${sl.stdout}${sl.stderr}`);
  assert.doesNotMatch(sl.stdout + sl.stderr, /RuntimeError/);
  assert.ok(sl.stdout.includes(` ${escaped}\n`), 'unzip -U -l shows every 31-bit character as #L7fffffff');
  const sd = await ctx.run(['unzip', '-U', '-d', 'six', 'six.zip'], { cwd, user: USER });
  assert.equal(sd.status, 0, `unzip -U -d six.zip: rc ${sd.status}\n${sd.stdout}${sd.stderr}`);
  assert.equal((await ctx.run(['cat', `six/${escaped}`], { cwd, user: USER })).stdout, 'w\n');
  assert.equal((await ctx.run(['cat', 'six/ok.txt'], { cwd, user: USER })).stdout, 'k\n');

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
