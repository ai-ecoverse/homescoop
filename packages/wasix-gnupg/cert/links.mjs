const GEN = (home, uid) => `gpg --homedir ${home} --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "${uid}" ed25519 sign never`;

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const sh = async (user, script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user !== 'root' && { user }) });
    return r.stdout + r.stderr;
  };

  const key = await sh('root', [
    'rm -rf /root/lk; mkdir -m 700 /root/lk',
    `${GEN('/root/lk', 'L1 <l1@example.org>')} > /dev/null 2>&1; echo "kgen=$?"`,
    'gpg --homedir /root/lk --batch --armor --export l1@example.org > /tmp/l1.asc; echo "kexp=$?"',
    'gpgconf --homedir /root/lk --kill gpg-agent',
    'rm -rf /srv/v; mkdir -p /srv/v; chmod 755 /srv/v',
    'for n in victim t2; do echo "SECRET $n" > /srv/v/$n; chmod 600 /srv/v/$n; done',
    'for n in victim t2; do echo "sum $n $(cksum < /srv/v/$n)"; done',
  ].join('\n'));
  assert.match(key, /^kexp=0$/m, `root exports a public key:\n${key}`);
  const sums = Object.fromEntries([...key.matchAll(/^sum (\S+) (.+)$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(sums.victim && sums.t2, `checksums of root's files:\n${key}`);

  const plant = await sh('cone', [
    'rm -rf ~/g ~/f ~/d; mkdir -m 700 ~/g ~/f ~/d',
    'gpg --homedir ~/g --batch -k > /dev/null 2>&1; gpgconf --homedir ~/g --kill gpg-agent',
    'rm -f ~/g/pubring.kbx~; ln -s /srv/v/victim ~/g/pubring.kbx~',
    'ln -s /srv/v/t2 ~/f/pubring.kbx.tmp',
    'ln -s /srv/v/new ~/d/pubring.kbx~',
    'gpg --homedir ~/d --batch -k > /dev/null 2>&1; gpgconf --homedir ~/d --kill gpg-agent',
    'ls -l ~/g/pubring.kbx~ ~/f/pubring.kbx.tmp ~/d/pubring.kbx~',
  ].join('\n'));
  assert.match(plant, /pubring\.kbx~ -> \/srv\/v\/victim/, `cone planted ~/g/pubring.kbx~:\n${plant}`);
  assert.match(plant, /pubring\.kbx\.tmp -> \/srv\/v\/t2/, `cone planted ~/f/pubring.kbx.tmp:\n${plant}`);
  assert.match(plant, /pubring\.kbx~ -> \/srv\/v\/new/, `cone planted a dangling ~/d/pubring.kbx~:\n${plant}`);

  const imp = await sh('root', [
    'for n in g f d; do gpg --homedir /home/cone/$n --batch --import /tmp/l1.asc > /dev/null 2>&1; echo "imp$n=$?"; gpgconf --homedir /home/cone/$n --kill gpg-agent; done',
    'for n in victim t2; do echo "sum $n $(cksum < /srv/v/$n)"; stat -c "own $n %U %a" /srv/v/$n; done',
    'ls /srv/v | while read -r f; do echo "in-v $f"; done',
    'for f in g/pubring.kbx~ g/pubring.kbx f/pubring.kbx d/pubring.kbx~; do stat -c "home $f %F %U" /home/cone/$f; done',
  ].join('\n'));
  for (const n of ['g', 'f', 'd']) assert.match(imp, new RegExp(`^imp${n}=0$`, 'm'), `root's import into cone's ~/${n}:\n${imp}`);
  for (const n of ['victim', 't2']) {
    assert.ok(imp.includes(`sum ${n} ${sums[n]}`), `root's /srv/v/${n}, the target of cone's symlink, is byte-identical after root's import (homescoop#1607; 2.4.9-13: overwritten with cone's keybox):\n${imp}`);
    assert.match(imp, new RegExp(`^own ${n} root 600$`, 'm'), `/srv/v/${n} stays root 600 (homescoop#1607; 2.4.9-12: cone 600):\n${imp}`);
  }
  assert.doesNotMatch(imp, /^in-v new$/m, `a dangling pubring.kbx~ symlink makes root create nothing at its target (homescoop#1607):\n${imp}`);
  for (const f of ['g/pubring.kbx~', 'g/pubring.kbx', 'f/pubring.kbx', 'd/pubring.kbx~']) {
    assert.ok(imp.includes(`home ${f} regular file cone`), `root's gpg writes ~/${f} as a regular file of cone's, never through cone's symlink (homescoop#1607):\n${imp}`);
  }
  const list = await sh('cone', 'for n in g f d; do gpg --homedir ~/$n --batch -k l1@example.org > /dev/null 2>&1; echo "k$n=$?"; gpgconf --homedir ~/$n --kill gpg-agent; done');
  for (const n of ['g', 'f', 'd']) assert.match(list, new RegExp(`^k${n}=0$`, 'm'), `cone lists the key root imported into ~/${n}:\n${list}`);

  await sh('cone', 'rm -rf ~/q; mkdir -m 700 ~/q');
  const rev = await sh('root', [
    `${GEN('/home/cone/q', 'R <r@example.org>')} > /dev/null 2>&1; echo "gen=$?"`,
    'gpgconf --homedir /home/cone/q --kill gpg-agent',
    'stat -c "rd %U %a" /home/cone/q/openpgp-revocs.d',
    'for f in /home/cone/q/openpgp-revocs.d/*.rev; do stat -c "rev %U %a" "$f"; done',
  ].join('\n'));
  assert.match(rev, /^gen=0$/m, `root generates a key in cone's empty homedir:\n${rev}`);
  assert.match(rev, /^rd cone 700$/m, `the openpgp-revocs.d root's gpg creates in cone's homedir is cone 700 (homescoop#1602; 2.4.9-13: root):\n${rev}`);
  assert.match(rev, /^rev cone 600$/m, `the revocation certificate root's gpg writes there is cone 600 (homescoop#1602; 2.4.9-13: root):\n${rev}`);
  assert.doesNotMatch(rev, /^rev (?!cone 600$)/m, `every .rev there is cone 600:\n${rev}`);
  const rm = await sh('cone', 'rm -rf ~/q; echo "rm=$?"; [ -e ~/q ] && echo "q still there"');
  assert.match(rm, /^rm=0$/m, `cone removes the homedir root's gpg used (homescoop#1602; 2.4.9-13: Permission denied):\n${rm}`);
  assert.doesNotMatch(rm, /still there|Permission denied/, `nothing of root's is left in cone's homedir:\n${rm}`);

  if (process.env.GNUPG_NOFOLLOW === '1') {
    const nf = await sh('root', [
      'rm -rf /srv/nf; mkdir -p /srv/nf; echo target > /srv/nf/t; ln -s /srv/nf/t /srv/nf/l; ln -s /srv/nf/none /srv/nf/d',
      'for n in l d; do ruby -e \'begin; File.open(ARGV[1], File::RDONLY | File::NOFOLLOW) { |f| puts "#{ARGV[0]} opened #{f.read.strip}" }; rescue SystemCallError => e; puts "#{ARGV[0]} refused #{e.class}"; end\' $n /srv/nf/$n; done',
    ].join('\n'));
    assert.match(nf, /^l refused Errno::ELOOP$/m, `slicc-kernel refuses a final symlink under O_NOFOLLOW (homescoop#1603; 1.124.1: opens the target):\n${nf}`);
    assert.match(nf, /^d refused Errno::E(LOOP|NOENT)$/m, `a dangling final symlink under O_NOFOLLOW is refused:\n${nf}`);
  }
  console.log(`links: a pubring.kbx~ or pubring.kbx.tmp that cone symlinks to root's 600 files leaves them byte-identical and root 600 after root's import, a dangling one creates nothing, and cone's keyboxes are regular files of cone's (#1607); openpgp-revocs.d and its .rev from root's --quick-gen-key in cone's homedir are cone's and cone removes the homedir (#1602)${process.env.GNUPG_NOFOLLOW === '1' ? '; the kernel refuses a final symlink under O_NOFOLLOW (#1603)' : ''}`);
}
