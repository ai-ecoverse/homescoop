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

  const params = (grip) => ['%no-protection', 'Key-Type: eddsa', ...(grip ? [`Key-Grip: ${grip}`] : []), 'Key-Curve: ed25519', 'Key-Usage: sign', 'Name-Real: F', 'Name-Email: f@example.org', 'Creation-Date: 20200101T000000', 'Expire-Date: 0'].map((l) => `'${l}'`).join(' ');
  const fixed = await sh('root', [
    'rm -rf /root/fs /srv/rv /srv/rd; mkdir -m 700 /root/fs; mkdir -m 755 /srv/rv /srv/rd; echo "SECRET rv" > /srv/rv/existing; chmod 600 /srv/rv/existing',
    'echo "sum $(cksum < /srv/rv/existing)"',
    `printf '%s\\n' ${params()} > /tmp/fs.params`,
    'gpg --homedir /root/fs --batch --generate-key /tmp/fs.params > /dev/null 2>&1; echo "fgen=$?"',
    'gpg --homedir /root/fs --batch --with-colons --with-keygrip -k | while IFS=: read -r t _ _ _ _ _ _ _ _ v _; do [ "$t" = fpr ] && echo "fpr $v"; [ "$t" = grp ] && echo "grp $v"; done',
    'gpgconf --homedir /root/fs --kill gpg-agent',
  ].join('\n'));
  assert.match(fixed, /^fgen=0$/m, `root generates a key with a fixed creation date:\n${fixed}`);
  const fpr = /^fpr (\S+)$/m.exec(fixed)?.[1];
  const grip = /^grp (\S+)$/m.exec(fixed)?.[1];
  assert.ok(fpr && grip, `its fingerprint and keygrip:\n${fixed}`);
  await sh('root', [
    `printf '%s\\n' ${params(grip)} > /tmp/fs2.params; chmod 644 /tmp/fs2.params`,
    'gpg --homedir /root/fs --batch --armor --export > /tmp/fs.asc',
    `cp /root/fs/private-keys-v1.d/${grip}.key /tmp/fs.key; chmod 644 /tmp/fs.key`,
  ].join('\n'));
  const plantRev = await sh('cone', [
    'rm -rf ~/q3 ~/q4 ~/q5; mkdir -m 700 ~/q3 ~/q3/private-keys-v1.d ~/q3/openpgp-revocs.d ~/q4 ~/q5 ~/q5/private-keys-v1.d ~/q5/openpgp-revocs.d',
    `for n in 3 5; do cp /tmp/fs.key ~/q$n/private-keys-v1.d/${grip}.key; chmod 600 ~/q$n/private-keys-v1.d/${grip}.key; done`,
    `ln -s /srv/rv/planted ~/q3/openpgp-revocs.d/${fpr}.rev`,
    `ln -s /srv/rv/existing ~/q5/openpgp-revocs.d/${fpr}.rev`,
    'ln -s /srv/rd ~/q4/openpgp-revocs.d',
    `ls -l ~/q3/openpgp-revocs.d/${fpr}.rev ~/q4/openpgp-revocs.d`,
  ].join('\n'));
  assert.match(plantRev, /\.rev -> \/srv\/rv\/planted/, `cone planted the .rev name of a key root's gpg will generate:\n${plantRev}`);
  assert.match(plantRev, /openpgp-revocs\.d -> \/srv\/rd/, `cone planted openpgp-revocs.d as a symlink to root's /srv/rd:\n${plantRev}`);
  const genRev = await sh('root', [
    'gpg --homedir /home/cone/q3 --batch --generate-key /tmp/fs2.params 2>&1; echo "q3=$?"',
    'gpgconf --homedir /home/cone/q3 --kill gpg-agent',
    'gpg --homedir /home/cone/q5 --batch --yes --generate-key /tmp/fs2.params 2>&1; echo "q5=$?"',
    'gpgconf --homedir /home/cone/q5 --kill gpg-agent',
    'echo "sum $(cksum < /srv/rv/existing)"; stat -c "own rv %U %a" /srv/rv/existing',
    `${GEN('/home/cone/q4', 'R4 <r4@example.org>')} 2>&1; echo "q4=$?"`,
    'gpgconf --homedir /home/cone/q4 --kill gpg-agent',
    'gpg --homedir /home/cone/q3 --batch --with-colons -k | while IFS=: read -r t _ _ _ _ _ _ _ _ v _; do [ "$t" = fpr ] && echo "q3fpr $v"; done',
    'for d in /srv/rv /srv/rd; do ls -A $d | while read -r f; do [ "$d/$f" = /srv/rv/existing ] || echo "in-root $d/$f"; done; done',
  ].join('\n'));
  const rvSum = /^sum (.+)$/m.exec(fixed)?.[1];
  assert.ok(rvSum && genRev.includes(`sum ${rvSum}`), `root's /srv/rv/existing, the target of the .rev name cone planted, is byte-identical after root's gpg --yes --generate-key (2.4.9-13: the revocation certificate):\n${genRev}`);
  assert.match(genRev, /^own rv root 600$/m, `/srv/rv/existing stays root 600:\n${genRev}`);
  assert.ok(genRev.includes(`q3fpr ${fpr}`), `root's gpg generated the key whose .rev name cone planted (the fingerprint is known in advance):\n${genRev}`);
  assert.doesNotMatch(genRev, /^in-root /m, `a .rev name, or an openpgp-revocs.d, that cone symlinks into a root directory makes root's gpg create nothing there (2.4.9-13: /srv/rd/<fpr>.rev):\n${genRev}`);

  await sh('root', 'rm -rf /srv/kr; mkdir -m 755 /srv/kr; echo "SECRET kt" > /srv/kr/kt; chmod 600 /srv/kr/kt');
  const ktSum = /^sum (.+)$/m.exec(await sh('root', 'echo "sum $(cksum < /srv/kr/kt)"'))?.[1];
    await sh('cone', 'rm -rf ~/k ~/k2; mkdir -m 700 ~/k ~/k2; ln -s /srv/kr/new ~/k/pub.gpg; : > ~/k2/pub.gpg; ln -s /srv/kr/kt ~/k2/pub.gpg.tmp');
  const kr = await sh('root', [
    'for n in k k2; do for a in l1 fs; do gpg --homedir /home/cone/$n --batch --no-default-keyring --keyring gnupg-ring:/home/cone/$n/pub.gpg --import /tmp/$a.asc 2>&1; echo "$n-$a=$?"; done; gpgconf --homedir /home/cone/$n --kill gpg-agent; done',
    'echo "sum $(cksum < /srv/kr/kt)"; stat -c "own kt %U %a" /srv/kr/kt',
    'ls -A /srv/kr | while read -r f; do echo "in-kr $f"; done',
    'for n in k k2; do stat -c "ring $n %F %U" /home/cone/$n/pub.gpg; done',
  ].join('\n'));
  assert.ok(ktSum && kr.includes(`sum ${ktSum}`), `root's /srv/kr/kt, the target of cone's ~/k2/pub.gpg.tmp, is byte-identical after root's imports into a gnupg-ring: keyring (2.4.9-13: overwritten with the keyring):\n${kr}`);
  assert.match(kr, /^own kt root 600$/m, `/srv/kr/kt stays root 600:\n${kr}`);
  assert.doesNotMatch(kr, /^in-kr new$/m, `a dangling gnupg-ring: keyring symlink makes root create nothing at its target:\n${kr}`);
  for (const n of ['k', 'k2']) assert.match(kr, new RegExp(`^ring ${n} regular file cone$`, 'm'), `the keyring root's gpg writes in cone's ~/${n} is a regular file of cone's (2.4.9-13: ~/k stays a symlink, ~/k2 root's):\n${kr}`);
  const krList = await sh('cone', 'for n in k k2; do gpg --homedir ~/$n --batch --no-default-keyring --keyring gnupg-ring:$HOME/$n/pub.gpg --with-colons -k 2>&1; echo "list-$n=$?"; gpgconf --homedir ~/$n --kill gpg-agent; done');
  for (const n of ['k', 'k2']) assert.match(krList, new RegExp(`^list-${n}=0$`, 'm'), `cone lists the keyring root's gpg wrote in ~/${n}:\n${krList}`);
  for (const uid of ['L1 <l1@example.org>', 'F <f@example.org>']) assert.equal(krList.split(uid).length - 1, 2, `both keyrings hold ${uid}:\n${krList}`);

  const own = await sh('root', [
    'gpg --homedir /root/lk --batch --with-colons -k l1@example.org | while IFS=: read -r t _ _ _ _ _ _ _ _ v _; do [ "$t" = fpr ] && echo "lfpr $v"; done',
    'for f in pubring.kbx trustdb.gpg; do echo "sum $f $(cksum < /root/lk/$f)"; stat -c "own $f %U %a" /root/lk/$f; done',
  ].join('\n'));
  const lfpr = /^lfpr (\S+)$/m.exec(own)?.[1];
  const ownSums = Object.fromEntries([...own.matchAll(/^sum (\S+) (.+)$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(lfpr && ownSums['pubring.kbx'] && ownSums['trustdb.gpg'], `root's own keybox and trustdb in /root/lk:\n${own}`);
  await sh('cone', 'rm -rf ~/dk ~/dt; mkdir -m 700 ~/dk ~/dt; ln -s /root/lk/pubring.kbx ~/dk/pubring.kbx; ln -s /root/lk/trustdb.gpg ~/dt/trustdb.gpg');
  const inplace = await sh('root', [
    `gpg --homedir /home/cone/dk --batch --yes --delete-key ${lfpr} 2>&1; echo "del=$?"`,
    'gpgconf --homedir /home/cone/dk --kill gpg-agent',
    `echo "${fpr}:4:" | gpg --homedir /home/cone/dt --batch --import-ownertrust 2>&1; echo "trust=$?"`,
    'gpgconf --homedir /home/cone/dt --kill gpg-agent',
    'for f in pubring.kbx trustdb.gpg; do echo "sum $f $(cksum < /root/lk/$f)"; stat -c "own $f %U %a" /root/lk/$f; done',
    'gpg --homedir /root/lk --batch -k l1@example.org > /dev/null 2>&1; echo "still=$?"',
    'gpgconf --homedir /root/lk --kill gpg-agent',
  ].join('\n'));
  for (const f of ['pubring.kbx', 'trustdb.gpg']) {
    assert.ok(inplace.includes(`sum ${f} ${ownSums[f]}`), `root's own /root/lk/${f}, the target of cone's symlink, is byte-identical after root's in-place edit of cone's homedir (--delete-key, --import-ownertrust; 2.4.9-13: edited):\n${inplace}`);
    const mode = new RegExp(`^own ${f.replace('.', '\\.')} root \\d+$`, 'm').exec(own)?.[0];
    assert.ok(mode && inplace.includes(mode), `/root/lk/${f} keeps its owner and mode (${mode}):\n${inplace}`);
  }
  assert.match(inplace, /^still=0$/m, `root's own keybox still holds its key:\n${inplace}`);

  if (process.env.GNUPG_NOFOLLOW === '1') {
    const nf = await sh('root', [
      'rm -rf /srv/nf; mkdir -p /srv/nf; echo target > /srv/nf/t; ln -s /srv/nf/t /srv/nf/l; ln -s /srv/nf/none /srv/nf/d',
      'for n in l d; do ruby -e \'begin; File.open(ARGV[1], File::RDONLY | File::NOFOLLOW) { |f| puts "#{ARGV[0]} opened #{f.read.strip}" }; rescue SystemCallError => e; puts "#{ARGV[0]} refused #{e.class}"; end\' $n /srv/nf/$n; done',
    ].join('\n'));
    assert.match(nf, /^l refused Errno::ELOOP$/m, `slicc-kernel refuses a final symlink under O_NOFOLLOW (homescoop#1603; 1.124.1: opens the target):\n${nf}`);
    assert.match(nf, /^d refused Errno::E(LOOP|NOENT)$/m, `a dangling final symlink under O_NOFOLLOW is refused:\n${nf}`);
  }
  console.log(`links: a pubring.kbx~ or pubring.kbx.tmp that cone symlinks to root's 600 files leaves them byte-identical and root 600 after root's import, a dangling one creates nothing, and cone's keyboxes are regular files of cone's (#1607), and so is a gnupg-ring: keyring root imports into, while a pub.gpg.tmp symlink to a root file leaves it unchanged; a .rev name of a key whose fingerprint cone knows in advance, or an openpgp-revocs.d, that cone symlinks into a root directory makes root create nothing there; a pubring.kbx or trustdb.gpg that cone symlinks to root's own leaves it byte-identical after root's --delete-key or --import-ownertrust there; openpgp-revocs.d and its .rev from root's --quick-gen-key in cone's homedir are cone's and cone removes the homedir (#1602)${process.env.GNUPG_NOFOLLOW === '1' ? '; the kernel refuses a final symlink under O_NOFOLLOW (#1603)' : ''}`);
}
