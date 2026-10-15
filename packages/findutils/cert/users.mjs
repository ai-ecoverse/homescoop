export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const sh = async (script, user) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
    assert.equal(r.status, 0, `${user ?? 'root'}: ${script}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout.trim().split('\n').filter(Boolean);
  };
  assert.deepEqual(await sh('rm -rf /tmp/fu-users && mkdir /tmp/fu-users && cd /tmp/fu-users && printf r > r && printf c > c && chown 1000:1000 c && chmod 755 /tmp/fu-users && stat -c "%u:%g %n" r c'), ['0:0 r', '1000:1000 c']);
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -user root'), ['./r'], 'find -user root lists the root-owned file only');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -uid 0'), ['./r'], 'find -uid 0 lists the root-owned file only');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -user cone'), ['./c'], "find -user cone lists cone's file only");
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -group 1000'), ['./c'], 'find -group 1000');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -printf "%u:%g %U:%G %p\\n" | sort'), ['cone:cone 1000:1000 ./c', 'root:root 0:0 ./r'], 'find -printf %u %g %U %G');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -nouser'), [], 'no file is -nouser');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -user cone', 'cone'), ['./c'], 'as cone: find -user cone');
  assert.deepEqual(await sh('cd /tmp/fu-users && find . -type f -user root', 'cone'), ['./r'], 'as cone: find -user root');
  console.log('users: find -user root / -uid 0 / -user cone / -group 1000 / -printf %u:%g %U:%G see the kernel\'s owners (0:0 and 1000:1000), as root and as cone');
}
