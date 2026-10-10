/**
 * wasix-gnupg 2.4.9-5 (H1, homescoop#207; wasix-sysroot -20, slicc-kernel
 * >= 1.47.1): gpg's homedir checks as root (the kernel's default) and as a
 * kernel.users.add user. gpg compares the homedir's owner with getuid(): both
 * now come from the kernel (process credentials; a file's owner is the
 * caller's ids), so each user's own ~/.gnupg is safe and a 755 one is not.
 * -4 (sysroot -17) was uid 1000 for everyone; as root on 1.47.1 its uid 1000
 * did not match the root-owned homedir ("unsafe ownership").
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const count = (text, re) => (text.match(re) ?? []).length;
  for (const user of ['root', 'cone']) {
    const sh = (script) => run(['bash', '-c', `unset GNUPGHOME; ${script} 2>&1`], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    const gen = await sh('gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "U <u@example.org>" default default never; echo "rc=$?"');
    assert.match(gen.stdout, /rc=0\s*$/, `${user} keygen:\n${gen.stdout}`);
    assert.doesNotMatch(gen.stdout, /unsafe (ownership|permissions)/, `${user}:\n${gen.stdout}`);
    const st = await sh('stat -c "%U %a" ~/.gnupg');
    assert.equal(st.stdout.trim(), `${user} 700`, `${user}: ${st.stdout}`);
    const list = await sh('gpg --batch --list-keys');
    assert.equal(count(list.stdout, /^uid /gm), 1, `${user} list-keys:\n${list.stdout}`);
    assert.equal(count(list.stdout, /unsafe/g), 0, `${user} list-keys:\n${list.stdout}`);
    // A group/world-readable homedir is still refused as unsafe.
    const loose = await sh('chmod 755 ~/.gnupg && gpg --batch --list-keys; chmod 700 ~/.gnupg');
    assert.match(loose.stdout, /unsafe permissions on homedir/, `${user} 755:\n${loose.stdout}`);
  }
}
