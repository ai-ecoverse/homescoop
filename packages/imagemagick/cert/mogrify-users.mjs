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
  const link = await as('kim', `cd ~/m && magick -size 40x40 xc:red real.png && chmod 640 real.png && chgrp users real.png && ln -s real.png l.png && mogrify -resize 50% l.png; echo rc=$?; stat -c "%F" l.png; readlink l.png; f=real.png; ${check}; ls`);
  assert.equal(link.stdout, 'rc=0\nsymbolic link\nreal.png\n20 20\nkim users 640\na.png\nb.png\nbig.png\nc.jpg\nl.png\nreal.png\n', `mogrify over a symlink l.png -> real.png keeps the link, and real.png gets the new image with its mode, group and owner: ${link.stdout}${link.stderr}`);
  console.log('mogrify-users: in-place mogrify keeps mode, group and owner: kim over her own 0644 kim:users and 0640 files, root over kim\'s 0644 and 0664 kim:users files, kim over root\'s 0666 file in a sticky and an open directory; a failed encode (mogrify, and magick over root\'s file) leaves the bytes, mode and owner on the rename and the copy path; a symlink stays a link and its target keeps its metadata (homescoop#1381)');
}
