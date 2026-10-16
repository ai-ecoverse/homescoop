/**
 * rsync 3.5.x's secure path resolver in the destination (homescoop#411;
 * upstream NEWS 3.5.0 "BEHAVIOR CHANGES", rsync.1 --keep-dirlinks and
 * --insecure-links), under users enforce:
 *
 * 1. a destination directory reached through a symlink another user owns
 *    (eve's /tmp/evelink → evereal, in sticky /tmp) is refused for cone,
 *    rc 3, "refusing to follow a symlink owned by an untrusted user", and
 *    nothing is copied; --insecure-links copies through it (the 3.4.x way);
 * 2. -K (--keep-dirlinks) into a destination dirlink with an absolute
 *    target is refused, rc 23, "Symbolic link loop"; an in-tree relative
 *    dirlink still works, rc 0, the file landing in the link's target.
 *
 * 3. what counts is the link's owner, not the caller (homescoop#555): cone's
 *    own link and a link root owns are followed (rc 0), root is refused
 *    through eve's link (rc 3), and -K refuses a dirlink escaping the tree
 *    (../out, rc 23) as it does an absolute one.
 *
 * 3.4.4-5 followed eve's link and wrote through the absolute dirlink (rc 0
 * both), NEGATIVE.md. A kernel change to symlink ownership or to
 * O_NOFOLLOW/openat would show up here.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  await addUser({ name: 'eve' });
  const sh = async (script, user) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
    return { ...r, all: `${user ?? 'root'}: ${script}\nrc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}` };
  };
  const ok = async (script, user) => {
    const r = await sh(script, user);
    assert.equal(r.status, 0, r.all);
    return r.stdout;
  };

  // 1. eve's symlink as cone's destination.
  await ok('rm -rf /tmp/evereal /tmp/evelink && mkdir -m 1777 /tmp/evereal');
  await ok('ln -s evereal /tmp/evelink && stat -c "%U %F" /tmp/evelink', 'eve');
  assert.equal(await ok('stat -c "%U %F" /tmp/evelink'), 'eve symbolic link\n', 'eve owns /tmp/evelink');
  await ok('rm -rf ~/s && mkdir -p ~/s/d && echo a > ~/s/d/f', 'cone');
  const refused = await sh('rsync -a ~/s/d /tmp/evelink/', 'cone');
  assert.equal(refused.status, 3, `cone's rsync into eve's link: ${refused.all}`);
  assert.match(refused.stderr, /refusing to follow a symlink owned by an untrusted user/, refused.all);
  assert.match(refused.stderr, /--insecure-links/, refused.all);
  assert.equal(await ok('ls -A /tmp/evereal | wc -l'), '0\n', 'nothing copied through the refused link');
  const insecure = await sh('rsync -a --insecure-links ~/s/d /tmp/evelink/ && cat /tmp/evereal/d/f && stat -c %U /tmp/evereal/d/f', 'cone');
  assert.equal(insecure.status, 0, `--insecure-links: ${insecure.all}`);
  assert.equal(insecure.stdout, 'a\ncone\n', insecure.all);

  // 2. -K into destination dirlinks.
  await ok('rm -rf /tmp/k && mkdir -p /tmp/k/src/d /tmp/k/dA /tmp/k/elsewhere /tmp/k/dR/real && echo b > /tmp/k/src/d/b && ln -s /tmp/k/elsewhere /tmp/k/dA/d && ln -s real /tmp/k/dR/d');
  const abs = await sh('rsync -aK /tmp/k/src/ /tmp/k/dA/');
  assert.equal(abs.status, 23, `-K into an absolute dirlink: ${abs.all}`);
  assert.match(abs.stderr, /Symbolic link loop/, abs.all);
  assert.equal(await ok('ls -A /tmp/k/elsewhere | wc -l; readlink /tmp/k/dA/d'), '0\n/tmp/k/elsewhere\n', 'nothing written through the absolute dirlink, which stays');
  const rel = await sh('rsync -aK /tmp/k/src/ /tmp/k/dR/ && readlink /tmp/k/dR/d && cat /tmp/k/dR/real/b');
  assert.equal(rel.status, 0, `-K into an in-tree relative dirlink: ${rel.all}`);
  assert.equal(rel.stdout, 'real\nb\n', rel.all);
  // 3. The link's owner counts, not the caller (homescoop#555).
  await ok('rm -rf ~/mt ~/mylink && mkdir ~/mt && ln -s mt ~/mylink', 'cone');
  const own = await sh('rsync -a ~/s/d ~/mylink/ && cat ~/mt/d/f', 'cone');
  assert.equal(own.status, 0, `cone into its own link: ${own.all}`);
  assert.equal(own.stdout, 'a\n', own.all);
  await ok('rm -rf /tmp/p && mkdir -p -m 755 /tmp/p && mkdir -m 1777 /tmp/p/rt && ln -s rt /tmp/p/rootlink');
  const rootLink = await sh('rsync -a ~/s/d /tmp/p/rootlink/ && cat /tmp/p/rt/d/f', 'cone');
  assert.equal(rootLink.status, 0, `cone into root's link: ${rootLink.all}`);
  assert.equal(rootLink.stdout, 'a\n', rootLink.all);
  const rootRefused = await sh('rm -rf /tmp/evereal/* && rsync -a /home/cone/s/d /tmp/evelink/; echo "rc=$?"; ls -A /tmp/evereal | wc -l');
  assert.equal(rootRefused.stdout, 'rc=3\n0\n', `root through eve's link: ${rootRefused.all}`);
  assert.match(rootRefused.stderr, /refusing to follow a symlink owned by an untrusted user/, rootRefused.all);
  await ok('rm -rf /tmp/q && mkdir -p /tmp/q/src/d /tmp/q/dst /tmp/q/out && echo y > /tmp/q/src/d/y && ln -s ../out /tmp/q/dst/d');
  const up = await sh('rsync -aK /tmp/q/src/ /tmp/q/dst/');
  assert.equal(up.status, 23, `-K into a ../out dirlink: ${up.all}`);
  assert.match(up.stderr, /Symbolic link loop/, up.all);
  assert.equal(await ok('ls -A /tmp/q/out | wc -l'), '0\n', 'nothing written through the ../out dirlink');
  console.log('symlink-dest: cone\'s own and root\'s links followed, root refused through eve\'s (rc 3), -K ../out rc 23; eve\'s link refused for cone (rc 3, untrusted user), --insecure-links copies; -K: absolute dirlink rc 23 (Symbolic link loop), in-tree relative dirlink rc 0');
}
