export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const sh = async (script, user) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
    assert.equal(r.status, 0, `${user ?? 'root'}: ${script}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout.trim().split('\n');
  };
  const stat = 'stat -c "%a %u:%g %n" f640 s4755 g2755';
  assert.deepEqual(await sh(`umask 022; rm -rf /tmp/tu && mkdir -p /tmp/tu/src && cd /tmp/tu/src && printf a > f640 && printf b > s4755 && printf c > g2755 && chown 1000:1000 f640 s4755 && chown 1000:100 g2755 && chmod 640 f640 && chmod 4755 s4755 && chmod 2755 g2755 && tar -cf /tmp/tu/a.tar f640 s4755 g2755 && chmod 755 /tmp/tu && chmod 644 /tmp/tu/a.tar && ${stat}`), [
    '640 1000:1000 f640',
    '4755 1000:1000 s4755',
    '2755 1000:100 g2755',
  ]);
  assert.deepEqual(await sh(`umask 022; mkdir /tmp/tu/root && cd /tmp/tu/root && tar -xf /tmp/tu/a.tar && ${stat}`), [
    '640 1000:1000 f640',
    '4755 1000:1000 s4755',
    '2755 1000:100 g2755',
  ], 'root: tar -x keeps owners and modes (--same-owner, --same-permissions by default)');
  assert.deepEqual(await sh(`umask 022; mkdir /tmp/tu/plain && cd /tmp/tu/plain && tar --no-same-owner --no-same-permissions -xf /tmp/tu/a.tar && ${stat}`), [
    '640 0:0 f640',
    '755 0:0 s4755',
    '755 0:0 g2755',
  ], 'root with --no-same-owner --no-same-permissions: its own ids, umask applied');
  assert.deepEqual(await sh(`umask 077; rm -rf /tmp/tu-cone && mkdir /tmp/tu-cone && cd /tmp/tu-cone && tar -xf /tmp/tu/a.tar && ${stat}`, 'cone'), [
    '600 1000:1000 f640',
    '700 1000:1000 s4755',
    '700 1000:1000 g2755',
  ], 'cone: its own ids, umask applied, setuid/setgid dropped');
  console.log('users: root tar -x keeps archive owners and modes (setuid, setgid); cone gets its own ids and its umask');
}
