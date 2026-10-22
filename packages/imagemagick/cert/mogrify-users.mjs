export default async function mogrifyUsers(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: 'kim' });
  const as = (user, script) => ctx.run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
  const check = 'magick identify -format "%w %h\\n" "$f"; stat -c "%U %G %a" "$f"';
  const mk = await as('kim', 'mkdir -p ~/m && cd ~/m && for f in a.png b.png c.jpg; do magick -size 40x40 xc:red $f || exit 1; done && chmod 644 a.png && chgrp users a.png && chmod 640 b.png && chmod 664 c.jpg && chgrp users c.jpg');
  assert.equal(mk.status, 0, mk.stderr);
  const own = await as('kim', `cd ~/m && mogrify -resize 50% a.png b.png; echo rc=$?; for f in a.png b.png; do ${check}; done; ls`);
  assert.equal(own.stdout, 'rc=0\n20 20\nkim users 644\n20 20\nkim kim 640\na.png\nb.png\nc.jpg\n', `kim's mogrify over her own 0644 kim:users a.png and 0640 b.png keeps mode, group and owner, no stray files (homescoop#1381): ${own.stdout}${own.stderr}`);
  const root = await as(null, `cd /home/kim/m && mogrify -resize 50% a.png c.jpg; echo rc=$?; for f in a.png c.jpg; do ${check}; done; ls`);
  assert.equal(root.stdout, 'rc=0\n10 10\nkim users 644\n20 20\nkim users 664\na.png\nb.png\nc.jpg\n', `root's mogrify over kim's 0644 a.png and 0664 c.jpg leaves them kim:users with their modes, no stray files (homescoop#1381): ${root.stdout}${root.stderr}`);
  const prep = await as(null, 'mkdir -m 1777 /tmp/msk && mkdir -m 777 /tmp/mop && for d in msk mop; do magick -size 40x40 xc:red /tmp/$d/w.png && chmod 666 /tmp/$d/w.png || exit 1; done');
  assert.equal(prep.status, 0, prep.stderr);
  const other = await as('kim', `for d in msk mop; do f=/tmp/$d/w.png; mogrify -resize 50% $f; echo rc=$?; ${check}; ls /tmp/$d; done`);
  assert.equal(other.stdout, 'rc=0\n20 20\nroot root 666\nw.png\nrc=0\n20 20\nroot root 666\nw.png\n', `kim's mogrify over root's 0666 w.png in a sticky and an open directory rewrites it in place, still root's 0666, no stray files (homescoop#1381, #1258): ${other.stdout}${other.stderr}`);
  const forced = 'mogrify -limit memory 24MiB -limit map 0 -depth 8';
  const mkBig = await as(null, 'for d in msk mop; do magick -size 1400x1000 gradient: /tmp/$d/big.png && chmod 666 /tmp/$d/big.png || exit 1; done');
  assert.equal(mkBig.status, 0, mkBig.stderr);
  const own2 = await as('kim', `cd ~/m && magick -size 1400x1000 gradient: big.png && chmod 644 big.png && s=$(cksum < big.png) && ${forced} big.png; echo rc=$?; [ "$(cksum < big.png)" = "$s" ] && echo same; f=big.png; stat -c "%U %G %a" $f; ls`);
  assert.equal(own2.stdout, 'rc=1\nsame\nkim kim 644\na.png\nb.png\nbig.png\nc.jpg\n', `a failed encode (cache resources exhausted at -depth 8) over kim's own big.png leaves its bytes, mode and owner, no stray files (the rename path): ${own2.stdout}${own2.stderr}`);
  assert.match(own2.stderr, /cache resources exhausted/);
  const other2 = await as('kim', `for d in msk mop; do f=/tmp/$d/big.png; s=$(cksum < $f); ${forced} $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; stat -c "%U %G %a" $f; ls /tmp/$d; done`);
  assert.equal(other2.stdout, 'rc=1\nsame\nroot root 666\nbig.png\nw.png\nrc=1\nsame\nroot root 666\nbig.png\nw.png\n', `a failed encode over root's 0666 big.png in a sticky and an open directory leaves its bytes, mode and owner, no stray files (the copy path): ${other2.stdout}${other2.stderr}`);
  const magick = await as('kim', 'for d in msk mop; do f=/tmp/$d/big.png; s=$(cksum < $f); magick -size 2000x1000 gradient: -limit memory 20MiB -limit map 0 -depth 8 $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; stat -c "%U %G %a" $f; ls /tmp/$d; done');
  assert.equal(magick.stdout, 'rc=1\nsame\nroot root 666\nbig.png\nw.png\nrc=1\nsame\nroot root 666\nbig.png\nw.png\n', `kim's magick write that fails over root's 0666 big.png leaves its bytes, mode and owner, no stray files (write-temp-then-rename.patch's copy path; #1258 wrote such a target in place): ${magick.stdout}${magick.stderr}`);
  const mkRd = await as(null, 'mkdir -m 755 /tmp/rd && magick -size 1400x1000 gradient: /tmp/rd/big.png && cp /tmp/rd/big.png /tmp/rd/big2.png && magick -size 40x40 xc:red /tmp/rd/w.png && chmod 666 /tmp/rd/big.png /tmp/rd/big2.png /tmp/rd/w.png');
  assert.equal(mkRd.status, 0, mkRd.stderr);
  const stray = 'shopt -s nullglob dotglob; t=(/tmp/*~ /tmp/rd/*~ "${TMPDIR:-/tmp}"/*~); echo ${#t[@]}';
  const rd = await as('kim', `f=/tmp/rd/big.png; s=$(cksum < $f); ${forced} $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; stat -c "%U %G %a" $f; f=/tmp/rd/big2.png; s=$(cksum < $f); magick -size 2000x1000 gradient: -limit memory 20MiB -limit map 0 -depth 8 $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; stat -c "%U %G %a" $f; f=/tmp/rd/w.png; mogrify -resize 50% $f; echo rc=$?; ${check}; ls /tmp/rd; ${stray}`);
  assert.equal(rd.stdout, 'rc=1\nsame\nroot root 666\nrc=1\nsame\nroot root 666\nrc=0\n20 20\nroot root 666\nbig.png\nbig2.png\nw.png\n0\n', `kim over root's 0666 files in root's 0755 /tmp/rd, where no temporary file can go beside the target (homescoop#1608): a failed mogrify over big.png and a failed magick write over big2.png leave their bytes, mode and owner (the image is encoded in $TMPDIR and copied in only when complete), a good mogrify still rewrites w.png as root's 0666, and no *~ file is left in /tmp/rd, /tmp or $TMPDIR: ${rd.stdout}${rd.stderr}`);
  const next = await as('kim', `f=/tmp/rd/big.png; s=$(cksum < $f); MAGICK_TEMPORARY_PATH=/nonexistent TMPDIR=/tmp/rd ${forced} $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; f=/tmp/rd/w.png; MAGICK_TEMPORARY_PATH=/nonexistent mogrify -resize 50% $f; echo rc=$?; ${check}; TMPDIR=/tmp/rd magick $f -resize 50% $f; echo rc=$?; ${check}; MAGICK_TEMPORARY_PATH=/tmp/rd TMPDIR=/nonexistent mogrify -resize 200% $f; echo rc=$?; ${check}; ls /tmp/rd; ${stray}`);
  assert.equal(next.stdout, 'rc=1\nsame\nrc=0\n10 10\nroot root 666\nrc=0\n5 5\nroot root 666\nrc=0\n10 10\nroot root 666\nbig.png\nbig2.png\nw.png\n0\n', `with $MAGICK_TEMPORARY_PATH or $TMPDIR missing or unwritable, the temporary file goes to the next of $MAGICK_TEMPORARY_PATH, $TMPDIR, /tmp: a failed mogrify still leaves big.png, and good mogrify and magick writes over root's w.png in /tmp/rd succeed, root root 666, no *~ left (homescoop#1656): ${next.stdout}${next.stderr}`);
  const mkOwn = await as(null, 'magick -size 40x40 xc:red /tmp/rd/kp.png && chown kim:kim /tmp/rd/kp.png && chmod 600 /tmp/rd/kp.png && magick -size 40x40 xc:red xc:blue /tmp/rd/anim.gif && chmod 666 /tmp/rd/anim.gif');
  assert.equal(mkOwn.status, 0, mkOwn.stderr);
  const frames = 'magick identify -format "%w %h\\n" /tmp/rd/anim.gif';
  const own3 = await as('kim', `mkdir -p ~/x && cd ~/x && magick -size 40x40 xc:red x.png && magick -size 40x40 xc:red y.png && chmod 644 x.png y.png && f=/tmp/rd/kp.png && TMPDIR=/tmp/rd mogrify -resize 50% $f ~/x/x.png; echo rc=$?; ${check}; f=~/x/x.png; ${check}; mogrify -resize 50% /tmp/rd/anim.gif; echo rc=$?; ${frames}; magick /tmp/rd/anim.gif -resize 50% /tmp/rd/anim.gif; echo rc=$?; ${frames}; stat -c "%U %G %a" /tmp/rd/anim.gif; ls /tmp/rd; ls ~/x; ${stray}`);
  assert.equal(own3.stdout, 'rc=0\n20 20\nkim kim 600\n20 20\nkim kim 644\nrc=0\n20 20\n20 20\nrc=0\n10 10\n10 10\nroot root 666\nanim.gif\nbig.png\nbig2.png\nkp.png\nw.png\nx.png\ny.png\n0\n', `in root's 0755 /tmp/rd: kim's own 0600 kp.png stays kim kim 600 and the next file of the same mogrify is written too (homescoop#1655, #1209); root's two-frame anim.gif keeps both frames through mogrify and magick, root root 666; nothing is left in /tmp (homescoop#1209, #1383): ${own3.stdout}${own3.stderr}`);
  const tmpMode = (await as(null, 'stat -c %a /tmp')).stdout.trim();
  assert.match(tmpMode, /^1?777$/, `/tmp is world-writable: ${tmpMode}`);
  const lock = await as(null, 'chmod 755 /tmp');
  assert.equal(lock.status, 0, lock.stderr);
  let none;
  try {
    none = await as('kim', `f=/tmp/rd/big2.png; s=$(cksum < $f); MAGICK_TEMPORARY_PATH=/nonexistent TMPDIR=/tmp/rd magick -size 2000x1000 gradient: -limit memory 20MiB -limit map 0 -depth 8 $f; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; f=/tmp/rd/w.png; s=$(cksum < $f); MAGICK_TEMPORARY_PATH=/nonexistent TMPDIR=/tmp/rd mogrify -resize 50% $f ~/x/x.png ~/x/y.png; echo rc=$?; [ "$(cksum < $f)" = "$s" ] && echo same; for f in ~/x/x.png ~/x/y.png; do ${check}; done; ls /tmp/rd; ls ~/x`);
  } finally {
    const unlock = await as(null, `chmod ${tmpMode} /tmp`);
    assert.equal(unlock.status, 0, unlock.stderr);
  }
  assert.equal(none.stdout, 'rc=1\nsame\nrc=1\nsame\n10 10\nkim kim 644\n20 20\nkim kim 644\nanim.gif\nbig.png\nbig2.png\nkp.png\nw.png\nx.png\ny.png\n', `with $MAGICK_TEMPORARY_PATH, $TMPDIR and /tmp all unwritable, kim's magick and mogrify over root's files in /tmp/rd are refused and leave them as they were, and the same mogrify still writes ~/x/x.png and ~/x/y.png (homescoop#1608, #1655, #1656): ${none.stdout}${none.stderr}`);
  const tried = /unable to create temporary file `\/tmp\/rd\/(big2|w)\.png': tried \/nonexistent \(No such file or directory\), \/tmp\/rd \(Permission denied\), \/tmp \(Permission denied\)/gi;
  assert.equal(none.stderr.match(tried)?.length, 2, `each refusal names the directories it tried and why (homescoop#1656): ${none.stderr}`);
  const grp = await as('kim', 'mkdir -p ~/g && cd ~/g && magick -size 40x40 xc:red mine.png && chmod 640 mine.png && chgrp users mine.png && magick -size 30x30 xc:blue mine.png; echo rc=$?; f=mine.png; ' + check + '; ls');
  assert.equal(grp.stdout, 'rc=0\n30 30\nkim users 640\nmine.png\n', `kim's magick over her own 0640 kim:users mine.png keeps the group users (homescoop#1383): ${grp.stdout}${grp.stderr}`);
  const rootOver = await as(null, 'cd /home/kim/g && magick -size 20x20 xc:blue mine.png; echo rc=$?; f=mine.png; ' + check + '; ls');
  assert.equal(rootOver.stdout, 'rc=0\n20 20\nkim users 640\nmine.png\n', `root's magick over kim's 0640 kim:users mine.png leaves it kim's (homescoop#1383): ${rootOver.stdout}${rootOver.stderr}`);
  const link = await as('kim', `cd ~/m && magick -size 40x40 xc:red real.png && chmod 640 real.png && chgrp users real.png && ln -s real.png l.png && mogrify -resize 50% l.png; echo rc=$?; stat -c "%F" l.png; readlink l.png; f=real.png; ${check}; ls`);
  assert.equal(link.stdout, 'rc=0\nsymbolic link\nreal.png\n20 20\nkim users 640\na.png\nb.png\nbig.png\nc.jpg\nl.png\nreal.png\n', `mogrify over a symlink l.png -> real.png keeps the link, and real.png gets the new image with its mode, group and owner: ${link.stdout}${link.stderr}`);
  console.log("mogrify-users: in-place mogrify keeps mode, group and owner: kim over her own 0644 kim:users and 0640 files, root over kim's 0644 and 0664 kim:users files, kim over root's 0666 file in a sticky and an open directory; a failed encode (mogrify, and magick over root's file) leaves the bytes, mode and owner on the rename and the copy path; a symlink stays a link and its target keeps its metadata (homescoop#1381); in a directory kim can't write, a failed write is encoded in $TMPDIR and leaves the file, or, when $MAGICK_TEMPORARY_PATH or $TMPDIR can't take it, in the next of them or /tmp (homescoop#1656), and is refused, naming the directories, only when all are unwritable; a refused file doesn't stop the other files of the same mogrify (homescoop#1655); kim's own 0600 file and a two-frame GIF in that directory (homescoop#1209); magick keeps kim's group users and root's write leaves kim's file kim's (homescoop#1383)");
}
