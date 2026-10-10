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
  for (const user of ['root', 'cone']) {
    const sh = (script) => run(['bash', '-c', `unset GNUPGHOME; ${script}`], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    const gen = await sh('gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "U <u@example.org>" default default never 2>&1; echo "rc=$?"');
    assert.match(gen.stdout, /rc=0\s*$/, `${user} keygen:\n${gen.stdout}${gen.stderr}`);
    assert.doesNotMatch(gen.stdout, /unsafe (ownership|permissions)/, `${user}:\n${gen.stdout}`);
    const st = await sh('stat -c "%U %a" ~/.gnupg; gpg --batch --list-keys 2>&1 | grep -c "^uid" ; gpg --batch --list-keys 2>&1 | grep -c unsafe || true');
    assert.deepEqual(st.stdout.trim().split('\n'), [`${user} 700`, '1', '0'], `${user}:\n${st.stdout}${st.stderr}`);
    // A group/world-readable homedir is still refused as unsafe.
    const loose = await sh('chmod 755 ~/.gnupg && gpg --batch --list-keys 2>&1 | grep -c "unsafe permissions on homedir"; chmod 700 ~/.gnupg');
    assert.equal(loose.stdout.trim(), '1', `${user} 755:\n${loose.stdout}${loose.stderr}`);
  }
}
