export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const kernelSet = (l) => /^HOSTNAME=/.test(l);
  for (const user of ['root', 'cone']) {
    const sh = (cmd) => run(['bash', '-c', cmd], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    for (const via of ['', 'timeout 5 ', 'nohup ', 'nice ']) {
      for (const [set, want] of [['', []], ['FOO=1 ', ['FOO=1']]]) {
        const cmd = `env -i ${set}${via}env 2>&1`;
        const r = await sh(cmd);
        assert.equal(r.status, 0, `${user}: ${cmd}: rc ${r.status} ${r.stdout}${r.stderr}`);
        const lines = r.stdout.split('\n').filter(Boolean).filter((l) => !kernelSet(l));
        assert.deepEqual(lines, want, `${user}: ${cmd} leaves exactly ${JSON.stringify(want)} and says nothing else (a HOSTNAME from the kernel aside), as GNU env on Linux; Emscripten's getEnvStrings added USER/LOGNAME=web_user, PATH=/, HOME=/home/web_user, PWD=/, LANG and _ (homescoop#612, shims/slicc/slicc-env.js from #1491): ${JSON.stringify(r.stdout)}`);
      }
    }
    for (const cmd of ['env -i env true', 'env -i timeout 5 true', 'env -i nice true']) {
      const r = await sh(`${cmd}; echo rc=$?`);
      assert.equal(r.stdout, 'rc=0\n', `${user}: ${cmd} finds true without a PATH (libc's default directories, never /): ${JSON.stringify(r)}`);
      assert.equal(r.stderr, '', `${user}: ${cmd}: ${r.stderr}`);
    }
  }
  console.log('env-i: as root and as cone, env -i [FOO=1] env, and through timeout, nohup and nice, leaves exactly what it says (no web_user, PATH=/, HOME, PWD, LANG or _), and env -i finds true without a PATH');
}
