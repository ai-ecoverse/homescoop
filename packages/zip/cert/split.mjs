// homescoop#440: a split archive merges back (zip -s 0 --out) with every
// byte, when the split size is a multiple of zip's 16 KiB copy buffer (1m,
// 64k: the middle splits end exactly on a read) and when it isn't (100k).
import { HOME, USER, sh } from './lib/zipkit.mjs';

export default async function split(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const cwd = `${HOME}/sp`;
  const mk = await sh(ctx, 'mkdir -p sp && cd sp && head -c 3000000 /dev/urandom > r.bin && head -c 400000 /dev/urandom > s.bin && sha256sum r.bin s.bin');
  assert.equal(mk.status, 0, mk.stderr);
  const sums = Object.fromEntries(mk.stdout.trim().split('\n').map((l) => l.split(/\s+/).reverse()));
  for (const [file, size, parts] of [['r.bin', '1m', ['sp1m.z01 1048576', 'sp1m.z02 1048576']], ['s.bin', '64k', []], ['s.bin', '100k', []]]) {
    const base = `sp${size}`;
    const z = await sh(ctx, `zip -q -s ${size} ${base}.zip ${file} && ls ${base}.*`, cwd);
    assert.equal(z.status, 0, `zip -s ${size}: rc ${z.status}\n${z.stdout}${z.stderr}`);
    const names = z.stdout.trim().split(/\s+/);
    assert.ok(names.length >= 3, `zip -s ${size} wrote ${names.length} parts`);
    for (const p of parts) {
      const [name, bytes] = p.split(' ');
      const st = await ctx.run(['stat', '-c', '%s', name], { cwd, user: USER });
      assert.equal(st.stdout.trim(), bytes, `${name} is ${bytes} bytes`);
    }
    const m = await ctx.run(['zip', '-s', '0', `${base}.zip`, '--out', `${base}-whole.zip`], { cwd, user: USER });
    assert.equal(m.status, 0, `zip -s 0 (${size}): rc ${m.status}\n${m.stdout}${m.stderr}`);
    const t = await ctx.run(['unzip', '-tq', `${base}-whole.zip`], { cwd, user: USER });
    assert.equal(t.status, 0, `unzip -tq of the merged ${size} split: rc ${t.status}\n${t.stdout}${t.stderr}`);
    const sum = await sh(ctx, `unzip -p ${base}-whole.zip | sha256sum`, cwd);
    assert.equal(sum.stdout.split(/\s+/)[0], sums[file], `merged ${size} split: unzip -p gives ${file}'s bytes`);
  }
}
