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

  const ro = await sh('root', [
    'rm -rf /root/ro /root/rs /srv/sk; mkdir -m 700 /root/ro /root/rs; mkdir -m 755 /srv/sk',
    `${GEN('/root/ro', 'RootOnly <ro@example.org>')} > /dev/null 2>&1; echo "rgen=$?"`,
    'gpg --homedir /root/ro --batch --with-colons -k ro@example.org | while IFS=: read -r t _ _ _ _ _ _ _ _ v _; do [ "$t" = fpr ] && echo "rfpr $v"; done',
    'gpgconf --homedir /root/ro --kill gpg-agent',
    'cp /root/ro/pubring.kbx /srv/sk/pubring.kbx; gpg --homedir /root/ro --batch --export ro@example.org > /srv/sk/ring.gpg; chmod 600 /srv/sk/pubring.kbx /srv/sk/ring.gpg',
    'for f in pubring.kbx ring.gpg; do echo "sum $f $(cksum < /srv/sk/$f)"; done',
  ].join('\n'));
  assert.match(ro, /^rgen=0$/m, `root generates a RootOnly key:\n${ro}`);
  const rfpr = /^rfpr (\S+)$/m.exec(ro)?.[1];
  const skSums = Object.fromEntries([...ro.matchAll(/^sum (\S+) (.+)$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(rfpr && skSums['pubring.kbx'] && skSums['ring.gpg'], `root's 600 keybox and keyring in /srv/sk:\n${ro}`);
  const plantSk = await sh('cone', [
    'rm -rf ~/s1 ~/s2 ~/s3; mkdir -m 700 ~/s1 ~/s2 ~/s3',
    'ln -s /srv/sk/pubring.kbx ~/s1/pubring.kbx; ln -s /srv/sk/pubring.kbx ~/s2/pubring.kbx; ln -s /srv/sk/ring.gpg ~/s3/pub.gpg',
    'cat ~/s1/pubring.kbx > /dev/null 2>&1; echo "cat=$?"',
  ].join('\n'));
  assert.match(plantSk, /^cat=[1-9]\d*$/m, `cone can't read root's 600 keybox through its own symlink:\n${plantSk}`);
  const viaSk = await sh('root', [
    'gpg --homedir /home/cone/s1 --batch --import /tmp/l1.asc 2>&1; echo "s1=$?"',
    'gpgconf --homedir /home/cone/s1 --kill gpg-agent',
    `${GEN('/home/cone/s2', 'S2 <s2@example.org>')} 2>&1; echo "s2=$?"`,
    'gpgconf --homedir /home/cone/s2 --kill gpg-agent',
    'gpg --homedir /home/cone/s3 --batch --no-default-keyring --keyring gnupg-ring:/home/cone/s3/pub.gpg --import /tmp/l1.asc 2>&1; echo "s3=$?"',
    'gpgconf --homedir /home/cone/s3 --kill gpg-agent',
    'for f in pubring.kbx ring.gpg; do echo "sum $f $(cksum < /srv/sk/$f)"; stat -c "own $f %U %a" /srv/sk/$f; done',
    'for f in s1/pubring.kbx s2/pubring.kbx s3/pub.gpg; do stat -c "link $f %F" /home/cone/$f; done',
  ].join('\n'));
  for (const n of ['s1', 's2', 's3']) assert.match(viaSk, new RegExp(`^${n}=[1-9]\\d*$`, 'm'), `root's gpg refuses to read a keybox or keyring that cone symlinked to root's 600 file in ~/${n} (homescoop#1654; 2.4.9-14: rc 0, the content copied into cone's files):\n${viaSk}`);
  for (const f of ['pubring.kbx', 'ring.gpg']) {
    assert.ok(viaSk.includes(`sum ${f} ${skSums[f]}`), `root's /srv/sk/${f} is byte-identical:\n${viaSk}`);
    assert.match(viaSk, new RegExp(`^own ${f.replace('.', '\\.')} root 600$`, 'm'), `/srv/sk/${f} stays root 600:\n${viaSk}`);
  }
  for (const f of ['s1/pubring.kbx', 's2/pubring.kbx', 's3/pub.gpg']) assert.ok(viaSk.includes(`link ${f} symbolic link`), `cone's ~/${f} is still cone's symlink:\n${viaSk}`);
  const scan = await sh('cone', [
    `ruby -e 'n = 0; Dir.glob(ARGV.map { |d| File.join(d, "**", "*") }, File::FNM_DOTMATCH).each { |f| next if File.symlink?(f) || !File.file?(f); n += 1; begin; b = File.binread(f); puts "leak #{f}" if b.include?("RootOnly") || b.include?("ro@example.org"); rescue SystemCallError => e; puts "unread #{f} #{e.class}"; end }; puts "scanned #{n}"' ~/s1 ~/s2 ~/s3`,
    'gpg --homedir ~/s1 --batch -k ro@example.org > /dev/null 2>&1; echo "ks1=$?"; gpgconf --homedir ~/s1 --kill gpg-agent',
    'gpg --homedir ~/s3 --batch --no-default-keyring --keyring gnupg-ring:$HOME/s3/pub.gpg -k ro@example.org > /dev/null 2>&1; echo "ks3=$?"; gpgconf --homedir ~/s3 --kill gpg-agent',
  ].join('\n'));
  assert.match(scan, /^scanned \d+$/m, `cone scanned its homedirs:\n${scan}`);
  assert.doesNotMatch(scan, /^leak /m, `no file cone can read in ~/s1, ~/s2 or ~/s3 holds root's RootOnly key after root's gpg ran there (homescoop#1654; 2.4.9-14: pubring.kbx, pubring.kbx~ and pub.gpg are byte copies or updates of root's 600 files):\n${scan}`);
  for (const n of ['ks1', 'ks3']) assert.match(scan, new RegExp(`^${n}=[1-9]\\d*$`, 'm'), `cone's gpg can't list root's RootOnly key (homescoop#1654; 2.4.9-14: it lists it):\n${scan}`);

  await sh('root', 'ln -s /root/ro/pubring.kbx /root/rs/pubring.kbx; ln -s /root/ro/trustdb.gpg /root/rs/trustdb.gpg');
  const trSum = /^sum (.+)$/m.exec(await sh('root', 'echo "sum $(cksum < /root/ro/trustdb.gpg)"'))?.[1];
  const rootDir = await sh('root', [
    'gpg --homedir /root/rs --batch -k ro@example.org > /dev/null 2>&1; echo "rlist=$?"',
    `echo "${fpr}:4:" | gpg --homedir /root/rs --batch --import-ownertrust 2>&1; echo "rtrust=$?"`,
    `gpg --homedir /root/rs --batch --yes --delete-key ${rfpr} 2>&1; echo "rdel=$?"`,
    'gpgconf --homedir /root/rs --kill gpg-agent',
    'gpg --homedir /root/ro --batch -k ro@example.org > /dev/null 2>&1; echo "rgone=$?"',
    'gpg --homedir /root/ro --batch --export-ownertrust 2>&1',
    'gpgconf --homedir /root/ro --kill gpg-agent',
    'echo "sum $(cksum < /root/ro/trustdb.gpg)"',
  ].join('\n'));
  for (const step of ['rlist', 'rtrust', 'rdel']) assert.match(rootDir, new RegExp(`^${step}=0$`, 'm'), `root's ${step} through root's own symlinks in its 700 /root/rs works (the root-only directory exception):\n${rootDir}`);
  assert.match(rootDir, /^rgone=[1-9]\d*$/m, `root's --delete-key in /root/rs edits /root/ro/pubring.kbx through the link:\n${rootDir}`);
  assert.ok(rootDir.includes(`${fpr}:4:`) && trSum && !rootDir.includes(`sum ${trSum}`), `root's --import-ownertrust in /root/rs writes /root/ro/trustdb.gpg through the link:\n${rootDir}`);

  const reg = await sh('cone', [
    'rm -rf ~/rg; mkdir -m 700 ~/rg',
    `${GEN('~/rg', 'RG <rg@example.org>')} > /dev/null 2>&1; echo "cgen=$?"`,
    'gpg --homedir ~/rg --batch --with-colons -k rg@example.org | while IFS=: read -r t _ _ _ _ _ _ _ _ v _; do [ "$t" = fpr ] && echo "cfpr $v"; done',
    'gpgconf --homedir ~/rg --kill gpg-agent',
  ].join('\n'));
  assert.match(reg, /^cgen=0$/m, `cone generates a key in ~/rg:\n${reg}`);
  const cfpr = /^cfpr (\S+)$/m.exec(reg)?.[1];
  assert.ok(cfpr, `cone's fingerprint:\n${reg}`);
  const edits = await sh('root', [
    'gpg --homedir /home/cone/rg --batch -k rg@example.org > /dev/null 2>&1; echo "list=$?"',
    `echo "${fpr}:4:" | gpg --homedir /home/cone/rg --batch --import-ownertrust 2>&1; echo "trust=$?"`,
    `gpg --homedir /home/cone/rg --batch --yes --delete-secret-and-public-key ${cfpr} 2>&1; echo "del=$?"`,
    'gpgconf --homedir /home/cone/rg --kill gpg-agent',
    'for f in pubring.kbx trustdb.gpg; do stat -c "rg $f %F %U" /home/cone/rg/$f; done',
  ].join('\n'));
  for (const step of ['list', 'trust', 'del']) assert.match(edits, new RegExp(`^${step}=0$`, 'm'), `root's ${step} on cone's regular keybox and trustdb works (homescoop#1424):\n${edits}`);
  for (const f of ['pubring.kbx', 'trustdb.gpg']) assert.ok(edits.includes(`rg ${f} regular file cone`), `cone's ~/rg/${f} is still a regular file of cone's:\n${edits}`);
  const after = await sh('cone', [
    'gpg --homedir ~/rg --batch -k rg@example.org > /dev/null 2>&1; echo "gone=$?"',
    'gpg --homedir ~/rg --batch --export-ownertrust 2>&1',
    'gpgconf --homedir ~/rg --kill gpg-agent',
  ].join('\n'));
  assert.match(after, /^gone=[1-9]\d*$/m, `root's --delete-secret-and-public-key removed cone's key (homescoop#1424):\n${after}`);
  assert.ok(after.includes(`${fpr}:4:`), `root's --import-ownertrust wrote cone's trustdb (homescoop#1424):\n${after}`);

  if (process.env.GNUPG_NOFOLLOW === '1') {
    const nf = await sh('root', [
      'rm -rf /srv/nf; mkdir -p /srv/nf; echo target > /srv/nf/t; ln -s /srv/nf/t /srv/nf/l; ln -s /srv/nf/none /srv/nf/d',
      'for n in l d; do ruby -e \'begin; File.open(ARGV[1], File::RDONLY | File::NOFOLLOW) { |f| puts "#{ARGV[0]} opened #{f.read.strip}" }; rescue SystemCallError => e; puts "#{ARGV[0]} refused #{e.class}"; end\' $n /srv/nf/$n; done',
    ].join('\n'));
    assert.match(nf, /^l refused Errno::ELOOP$/m, `slicc-kernel refuses a final symlink under O_NOFOLLOW (homescoop#1603; 1.124.1: opens the target):\n${nf}`);
    assert.match(nf, /^d refused Errno::E(LOOP|NOENT)$/m, `a dangling final symlink under O_NOFOLLOW is refused:\n${nf}`);
  }
  console.log(`links: a pubring.kbx~ or pubring.kbx.tmp that cone symlinks to root's 600 files leaves them byte-identical and root 600 after root's import, a dangling one creates nothing, and cone's keyboxes are regular files of cone's (#1607), and so is a gnupg-ring: keyring root imports into, while a pub.gpg.tmp symlink to a root file leaves it unchanged; a .rev name of a key whose fingerprint cone knows in advance, or an openpgp-revocs.d, that cone symlinks into a root directory makes root create nothing there; a pubring.kbx or trustdb.gpg that cone symlinks to root's own leaves it byte-identical after root's --delete-key or --import-ownertrust there; openpgp-revocs.d and its .rev from root's --quick-gen-key in cone's homedir are cone's and cone removes the homedir (#1602); root's gpg refuses a keybox or gnupg-ring: keyring that cone symlinked to root's 600 files, and no file cone can read holds their content (#1654); root's own symlinks in its 700 directory are still read and edited, and so are cone's regular keybox and trustdb (#1424)${process.env.GNUPG_NOFOLLOW === '1' ? '; the kernel refuses a final symlink under O_NOFOLLOW (#1603)' : ''}`);
}
