// homescoop#1245, #1207, write-temp-then-rename.patch: as a non-root user
// under users enforce, a read-only target is refused as upstream refuses it
// (the rename must not replace a file the user may not write), and a format
// without an encoder (HEIC here) fails with "no encode delegate", leaving an
// existing target and no temporary file behind. A target another user owns
// is rewritten in place, as upstream does (#1258).
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
  // homescoop#1258: a target another user owns keeps upstream's in-place
  // write: in a sticky directory a rename over it would be refused, and in an
  // open one it would hand the file to the writer.
  const prep = await ctx.run(['bash', '-c', 'mkdir -m 1777 /tmp/sk /tmp/op && chmod 777 /tmp/op && for d in sk op; do magick -size 10x10 xc:red /tmp/$d/w.png && chmod 666 /tmp/$d/w.png; done'], { cwd: '/tmp' });
  assert.equal(prep.status, 0, prep.stderr);
  const other = await sh('for d in sk op; do magick -size 20x20 xc:blue /tmp/$d/w.png; echo rc=$?; magick identify -format "%w %h\\n" /tmp/$d/w.png; stat -c "%U %a" /tmp/$d/w.png; ls /tmp/$d; done');
  assert.equal(other.stdout, 'rc=0\n20 20\nroot 666\nw.png\nrc=0\n20 20\nroot 666\nw.png\n', `cone writes over root's 0666 w.png in a sticky and an open directory: rewritten in place, still root's, no temp file (homescoop#1258): ${other.stdout}${other.stderr}`);
  console.log('atomic-write-users: as cone a 0444 target is refused and kept (#1245); a HEIC write fails with no encode delegate and keeps the target, no temp files (#1207); root\'s 0666 file in /tmp (sticky) and an open dir is rewritten in place and stays root\'s (#1258)');
}
