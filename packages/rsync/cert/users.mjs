export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const sh = async (script, user) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
    assert.equal(r.status, 0, `${user ?? 'root'}: ${script}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout.trim().split('\n');
  };
  assert.deepEqual(await sh('umask 022; rm -rf ~/ru && mkdir -p ~/ru/d && printf a > ~/ru/f && printf b > ~/ru/d/g && chmod 640 ~/ru/f && chmod 4755 ~/ru/d/g && cd ~/ru && stat -c "%a %u:%g %n" f d/g', 'cone'), [
    '640 1000:1000 f',
    '4755 1000:1000 d/g',
  ]);
  assert.deepEqual(await sh('umask 022; rm -rf /tmp/ru-root && rsync -a /home/cone/ru/ /tmp/ru-root/ && cd /tmp/ru-root && stat -c "%a %u:%g %n" . f d d/g'), [
    '755 1000:1000 .',
    '640 1000:1000 f',
    '755 1000:1000 d',
    '4755 1000:1000 d/g',
  ], 'root: rsync -a keeps owners (-o -g) and modes');
  await sh('umask 022; rm -rf /tmp/ru-src && mkdir -p /tmp/ru-src && printf r > /tmp/ru-src/rf && chown 0:100 /tmp/ru-src/rf && chmod 644 /tmp/ru-src/rf && chmod 755 /tmp/ru-src');
  assert.deepEqual(await sh('umask 077; rm -rf ~/ru-copy && rsync -a /tmp/ru-src/ ~/ru-copy/ && stat -c "%a %u:%g %n" ~/ru-copy/rf', 'cone'), [
    '644 1000:100 /home/cone/ru-copy/rf',
  ], 'cone: rsync -a gives its own uid and keeps a group it belongs to (users, 100)');
  const links = await run(['bash', '-c', 'cd ~ && rm -rf rs rd && mkdir -p rs/sub && echo a > rs/f && ln -s f rs/l && ln -s nowhere rs/dang && ln -s sub rs/dl && rsync -a rs/ rd/; echo "rc=$?"; stat -c "%U:%G %F %n" rd/l rd/dang rd/dl; readlink rd/l rd/dang rd/dl'], { cwd: '/home/cone', user: 'cone' });
  assert.deepEqual(links.stdout.trim().split('\n'), [
    'rc=0',
    'cone:cone symbolic link rd/l',
    'cone:cone symbolic link rd/dang',
    'cone:cone symbolic link rd/dl',
    'f',
    'nowhere',
    'sub',
  ], `cone rsync -a of a tree with symlinks: ${links.stdout}${links.stderr}`);
  console.log('users: root rsync -a keeps owners and modes; cone gets its own uid and keeps its supplementary group 100; cone rsync -a copies symlinks with rc 0 (slicc-kernel 1.73.3, #449)');
}
