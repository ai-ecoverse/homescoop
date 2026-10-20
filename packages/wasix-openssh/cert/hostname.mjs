export default async function hostname(ctx) {
  const { assert, runAs, addUser } = ctx;
  await addUser({ name: 'cone' });
  for (const [user, home] of [['root', '/root'], ['cone', '/home/cone']]) {
    const r = await runAs(user, ['bash', '-c', `mkdir -p -m 700 ${home}/.ssh; rm -f ${home}/.ssh/hn ${home}/.ssh/hn.pub; ssh-keygen -q -t ed25519 -N '' -f ${home}/.ssh/hn && echo "node=$(env | sed -n 's/^HOSTNAME=//p' | head -1)" && ssh-keygen -l -f ${home}/.ssh/hn.pub`]);
    assert.equal(r.status, 0, `${user}: rc=${r.status} ${r.stdout}${r.stderr}`);
    const node = /^node=(.*)$/m.exec(r.stdout)?.[1] || 'slicc';
    const comment = /^256 SHA256:\S+ (\S+) \(ED25519\)$/m.exec(r.stdout)?.[1];
    assert.equal(comment, `${user}@${node}`, `${user}: ssh-keygen's default comment is user@ the exported HOSTNAME, else slicc (wasix-sysroot >= -36's gethostname; 10.6.0-11: root@wasmer.sh): ${r.stdout}`);
    assert.doesNotMatch(r.stdout, /wasmer\.sh/, `${user}: no wasmer.sh: ${r.stdout}`);
  }
  console.log('hostname: ssh-keygen\'s default comment is <user>@$HOSTNAME (else @slicc) for root and cone, not @wasmer.sh');
}
