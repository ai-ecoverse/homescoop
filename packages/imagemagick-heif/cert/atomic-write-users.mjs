// homescoop#1245, #1207, write-temp-then-rename.patch: as a non-root user
// under users enforce, a read-only target is refused as upstream refuses it
// (the rename must not replace a file the user may not write), and a format
// without an encoder (HEIC here) fails with "no encode delegate", leaving an
// existing target and no temporary file behind.
export default async function atomicWriteUsers(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'cone' });
  const sh = (script) => ctx.run(['bash', '-c', script], { cwd: '/tmp', user: 'cone' });
  const mk = await sh('cd ~ && mkdir -p aw && cd aw && magick -size 10x10 xc:red ro.png && chmod 444 ro.png && printf old > keep.heic');
  assert.equal(mk.status, 0, mk.stderr);
  const ro = await sh('cd ~/aw && magick -size 20x20 xc:blue ro.png; echo rc=$?; magick identify -format "%w %h\\n" ro.png; stat -c %a ro.png; ls');
  assert.equal(ro.stdout, 'rc=1\n10 10\n444\nkeep.heic\nro.png\n', `a 0444 target as cone: refused and unchanged, no temp file (homescoop#1245): ${ro.stdout}${ro.stderr}`);
  assert.match(ro.stderr, /Permission denied/);
  const heic = await sh('cd ~/aw && magick -size 20x20 xc:blue keep.heic; echo rc=$?; cat keep.heic; echo; ls');
  assert.equal(heic.stdout, 'rc=1\nold\nkeep.heic\nro.png\n', `HEIC has no encoder: refused, keep.heic unchanged, no HEIC:… temp file (homescoop#1207): ${heic.stdout}${heic.stderr}`);
  assert.match(heic.stderr, /no encode delegate for this image format `HEIC'/);
  console.log('atomic-write-users: as cone a 0444 target is refused and kept (#1245); a HEIC write fails with no encode delegate and keeps the target, no temp files (#1207)');
}
