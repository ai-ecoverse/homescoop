import { HOME, USER, sh, storedZip, writeBytes } from './lib/zipkit.mjs';

export default async function pkbit(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const u8 = (s) => Buffer.from(s);
  const cwd = `${HOME}/pk`;
  await sh(ctx, `mkdir -p '${cwd}'`);
  const zip = storedZip([
    { name: u8('pk.txt'), data: u8('pk\n'), internal: 0x0004, external: (0o100755 << 16) >>> 0 },
    { name: u8('ro.txt'), data: u8('ro\n'), internal: 0x0004, external: ((0o104777 << 16) | 0x01) >>> 0 },
    { name: u8('ln'), data: u8('pk.txt'), internal: 0x0004, external: ((0o120777 << 16) | 0x20) >>> 0 },
    { name: u8('plain.txt'), data: u8('plain\n'), external: (0o100750 << 16) >>> 0 },
  ]);
  await writeBytes(ctx, `${cwd}/pk.zip`, zip);
  const um = await sh(ctx, 'umask', cwd);
  assert.equal(um.status, 0, um.stderr);
  const mask = parseInt(um.stdout.trim(), 8);
  const ex = await ctx.run(['unzip', '-o', '-d', 'out', 'pk.zip'], { cwd, user: USER });
  assert.equal(ex.status, 0, `unzip -d of entries with the PKWARE verification bit: rc ${ex.status}\n${ex.stdout}${ex.stderr}`);
  const st = await sh(ctx, 'stat -c "%n %a %F" out/pk.txt out/ro.txt out/ln out/plain.txt', cwd);
  assert.equal(st.status, 0, st.stderr);
  const modes = Object.fromEntries(st.stdout.trim().split('\n').map((l) => {
    const [n, a, ...type] = l.split(' ');
    return [n.replace('out/', ''), { mode: parseInt(a, 8), type: type.join(' ') }];
  }));
  const want = (m) => (m & ~mask).toString(8);
  assert.equal(modes['pk.txt'].mode.toString(8), want(0o666), `pk.txt (bit 2, stored 0755): 0666 less the umask ${mask.toString(8)}, not mode 000: ${st.stdout}`);
  const cat = await ctx.run(['cat', 'out/pk.txt'], { cwd, user: USER });
  assert.equal(cat.status, 0, `cone reads out/pk.txt: ${cat.stderr}`);
  assert.equal(cat.stdout, 'pk\n');
  assert.equal(modes['ro.txt'].mode.toString(8), want(0o444), `ro.txt (bit 2, DOS read-only, setuid in the upper bytes): 0444 less the umask, no setuid: ${st.stdout}`);
  assert.match(modes.ln.type, /regular/, `ln (bit 2, a symlink type in the upper bytes) is a regular file: ${st.stdout}`);
  const ln = await ctx.run(['cat', 'out/ln'], { cwd, user: USER });
  assert.equal(ln.stdout, 'pk.txt', `out/ln holds the entry's bytes: ${ln.stderr}`);
  assert.equal(modes['plain.txt'].mode.toString(8), '750', `plain.txt (no bit 2) keeps its stored mode 0750: ${st.stdout}`);
  console.log(`pkbit: an entry with the PKWARE verification bit extracts as a regular file with 0666 (0444 read-only) less the umask ${mask.toString(8)}, readable by its owner; an entry without it keeps its stored mode`);
}
