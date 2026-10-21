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
  console.log('mogrify-users: in-place mogrify keeps mode, group and owner: kim over her own 0644 kim:users and 0640 files, root over kim\'s 0644 and 0664 kim:users files, kim over root\'s 0666 file in a sticky and an open directory (homescoop#1381)');
}
