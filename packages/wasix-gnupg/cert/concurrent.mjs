/**
 * Concurrent gpg runs on one homedir (homescoop#712).
 *
 * 1. Exclusion: a ruby process holds an fcntl write lock on
 *    pubring.kbx.lock; gpg must say "waiting for lock" and write its key
 *    only after the release (2.4.9-8: dotlock as an fcntl lock, since OPFS
 *    has no hard links, slicc-kernel#563).
 * 2. Six gpg --import runs of six distinct keys at once into a fresh
 *    homedir, three rounds as root and one as cone (slicc-bios#496's test):
 *    every run exits 0, every key is in the keyring, and no run logs an
 *    error. 2.4.9-8 loses keys here: a gpg that probes pubring.kbx while
 *    another creates it sees an empty file, takes it for a pubring.gpg
 *    keyring and fails with "invalid packet (ctb=00)" (2.4.9-9 creates the
 *    keybox by renaming a complete file into place).
 * 2b. After an import, pubring.kbx doesn't share its inode number with a
 *    new pubring.kbx.tmp, and no tmp file is left (2.4.9-10, homescoop#966,
 *    slicc-kernel#954). Four readers (gpg -k, gpg --list-keys --with-colons)
 *    run alongside six imports into a keybox holding six keys: every read
 *    exits 0 with no error and lists the held keys, and every key is kept.
 *    2.4.9-9 shares the inode number, and its readers sometimes fail with
 *    "keydb_search_next failed: Provided object is too short".
 * 3. Four parallel --quick-gen-key runs in one homedir: all succeed and
 *    keep their keys, --check-trustdb is clean. No tolerance for unlocked
 *    keybox reads: renames are atomic for other processes since
 *    slicc-kernel 1.117.2 (slicc-kernel#925, homescoop#934).
 */
const N = 4;
const READERS = 4;
const READER_ROUNDS = 1;

// Six distinct public keys (ed25519, uids tide1 … tide6 <tideN@example.test>).
const KEYS = [
  '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',
];

// Six more (uids tide7 … tide12), already in the keybox before the concurrent
// imports of the existing-keybox rounds.
const HELD = [
  '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',
];

// Holds F_WRLCK on ARGV[0] until gpg's log (ARGV[1]) says it waits, then 1 s
// more (at most 60 s).
const HOLDER = String.raw`
log = ->(s) { File.write("/tmp/gpg-order", s + "\n", mode: "a") }
f = File.open(ARGV[0], File::RDWR | File::CREAT)
f.fcntl(14, [1, 0, 0, 0, 0].pack("s s x4 q q l x4"))
log.("held")
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 60
sleep 0.2 until (File.exist?(ARGV[1]) && File.read(ARGV[1]).include?("waiting for lock")) || Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
sleep 1
log.("released")
f.fcntl(13, [2, 0, 0, 0, 0].pack("s s x4 q q l x4"))
`;

const GEN = (i) => `gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "U${i} <u${i}@example.org>" ed25519 sign never`;
const UIDS = 'gpg --batch --with-colons -k | while IFS=: read -r t _ _ _ _ _ _ _ _ u _; do [ "$t" = uid ] && echo "uid $u"; done';

export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  const sh = async (script, opts = {}) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...opts });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, `rc=${r.status}\n${out}`);
    return out;
  };

  // 1. A process holding the lock file's fcntl lock keeps gpg out.
  await write('/tmp/gpg-holder.rb', HOLDER);
  const ex = await sh([
    'export GNUPGHOME=/tmp/gx; rm -rf $GNUPGHOME /tmp/gx.log; mkdir -m 700 -p $GNUPGHOME; : > /tmp/gpg-order',
    `${GEN(0)} > /dev/null 2>&1`,
    'ruby /tmp/gpg-holder.rb $GNUPGHOME/pubring.kbx.lock /tmp/gx.log &',
    'until [[ "$(< /tmp/gpg-order)" == *held* ]]; do sleep 0.2; done',
    `${GEN(1)} > /tmp/gx.log 2>&1; echo "gpg rc=$?" >> /tmp/gpg-order`,
    'wait',
    'cat /tmp/gpg-order; echo "== log"; cat /tmp/gx.log; echo "== uids"', UIDS,
    'gpgconf --kill gpg-agent',
  ].join('\n'));
  assert.match(ex, /^held\nreleased\ngpg rc=0\n/, `gpg finishes only after the holder released pubring.kbx.lock:\n${ex}`);
  assert.match(ex, /waiting for lock .*pubring\.kbx\.lock/, `gpg waits for the lock (2.4.9-7 doesn't):\n${ex}`);
  assert.match(ex, /^uid U0 <u0@example\.org>\nuid U1 <u1@example\.org>$/m, `both keys:\n${ex}`);

  // 2. Six concurrent imports of distinct keys into a fresh homedir, then
  //    into one whose keybox exists: empty (gpg -k ran once) or holding six
  //    other keys (homescoop#956).
  await addUser({ name: 'cone' });
  await write('/tmp/gpg-keys.b64', KEYS.join('\n') + '\n');
  await write('/tmp/gpg-held.b64', HELD.join('\n') + '\n');
  await sh(`i=0; while read -r k; do i=$((i + 1)); echo "$k" | base64 -d > /tmp/gpg-key-$i.gpg; done < /tmp/gpg-keys.b64; while read -r k; do echo "$k" | base64 -d; done < /tmp/gpg-held.b64 > /tmp/gpg-held.gpg; chmod 644 /tmp/gpg-key-*.gpg /tmp/gpg-held.gpg`);
  const PREFILL = {
    fresh: () => [],
    empty: (gh) => [`gpg --homedir ${gh} --batch -k > /dev/null 2>&1`],
    held: (gh) => [`gpg --homedir ${gh} --batch --import /tmp/gpg-held.gpg > /dev/null 2>&1 || echo "prefill failed"`],
  };
  const rounds = [
    ['root', 1, 'fresh'], ['root', 2, 'fresh'], ['root', 3, 'fresh'], ['cone', 4, 'fresh'],
    ['root', 5, 'empty'], ['root', 6, 'held'], ['root', 7, 'held'], ['root', 8, 'held'], ['cone', 9, 'held'],
  ];
  for (const [user, round, prefill] of rounds) {
    const gh = `${user === 'root' ? '/root' : `/home/${user}`}/imp${round}`;
    const held = prefill === 'held' ? HELD.length : 0;
    const out = await sh([
      `rm -rf ${gh} ${gh}.*.log; mkdir -m 700 -p ${gh}`,
      ...PREFILL[prefill](gh),
      `[ ${prefill === 'fresh' ? '!' : ''} -s ${gh}/pubring.kbx ] || echo "prefill: unexpected keybox state"`,
      `for i in $(seq ${KEYS.length}); do (gpg --homedir ${gh} --batch --import /tmp/gpg-key-$i.gpg > ${gh}.$i.log 2>&1; echo "rc$i=$?" >> ${gh}.$i.log) & done; wait`,
      `for i in $(seq ${KEYS.length}); do echo "== $i"; cat ${gh}.$i.log; done`,
      `echo "== list"; GNUPGHOME=${gh} ${UIDS}`,
      `gpgconf --homedir ${gh} --kill gpg-agent`,
    ].join('\n'), { cwd: gh.replace(/\/imp\d$/, ''), ...(user === 'cone' && { user }) });
    assert.doesNotMatch(out, /^prefill/m, `${user} round ${round} (${prefill}): keybox set up:\n${out}`);
    const runs = out.split(/^== /m).slice(1, KEYS.length + 1);
    for (let i = 1; i <= KEYS.length; i++) {
      assert.match(runs[i - 1], new RegExp(`^rc${i}=0$`, 'm'), `${user} round ${round} (${prefill}): import ${i} exits 0:\n${out}`);
      assert.doesNotMatch(runs[i - 1], /error|invalid|failed|Oops|lockfile|can't lock|not locked|General/i, `${user} round ${round} (${prefill}): import ${i} logs no error:\n${out}`);
    }
    const listed = new Set(out.match(/^uid tide\d+ <tide\d+@example\.test>$/gm) ?? []);
    for (let i = 1; i <= KEYS.length + held; i++) {
      assert.ok(listed.has(`uid tide${i} <tide${i}@example.test>`), `${user} round ${round} (${prefill}): key tide${i} kept:\n${out}`);
    }
    assert.equal(listed.size, KEYS.length + held, `${user} round ${round} (${prefill}): ${KEYS.length + held} keys:\n${out}`);
  }

  // 2b. Readers alongside the imports (homescoop#966). On slicc-kernel's OPFS
  //     root a file created under a just-renamed-away name gets the renamed
  //     file's st_ino (slicc-kernel#954), so with one tmp name per keybox
  //     every version of pubring.kbx shares one inode number and a reader
  //     can read the wrong file's bytes. 2.4.9-10 writes each update to a tmp
  //     name of its own: after an import, pubring.kbx's inode number is not
  //     the one a new pubring.kbx.tmp gets, and no tmp file is left. Then
  //     four readers run gpg -k and gpg --list-keys --with-colons while six
  //     imports go into a keybox holding six keys (one round: more rounds
  //     run into slicc-kernel#980, an OPFS call that never answers).
  const ino = await sh([
    'gh=/root/ino; rm -rf $gh; mkdir -m 700 -p $gh',
    'gpg --homedir $gh --batch --import /tmp/gpg-held.gpg > /dev/null 2>&1; gpg --homedir $gh --batch --import /tmp/gpg-key-1.gpg > /dev/null 2>&1',
    'a=$(stat -c %i $gh/pubring.kbx); : > $gh/pubring.kbx.tmp; b=$(stat -c %i $gh/pubring.kbx.tmp); rm -f $gh/pubring.kbx.tmp',
    'echo "kbx=$a tmp=$b"; ls $gh; gpgconf --homedir $gh --kill gpg-agent',
  ].join('\n'));
  const [, kbxIno, tmpIno] = /^kbx=(\d+) tmp=(\d+)$/m.exec(ino) ?? [];
  assert.ok(kbxIno && tmpIno, `inode numbers:\n${ino}`);
  assert.notEqual(kbxIno, tmpIno, `pubring.kbx doesn't share its inode number with a new pubring.kbx.tmp (2.4.9-9 renames every update from pubring.kbx.tmp):\n${ino}`);
  assert.doesNotMatch(ino, /^pubring\.kbx\.tmp/m, `no tmp file left:\n${ino}`);
  for (let round = 1; round <= READER_ROUNDS; round++) {
    const gh = `/root/rd${round}`;
    const out = await sh([
      `rm -rf ${gh} ${gh}.*; mkdir -m 700 -p ${gh}`,
      PREFILL.held(gh)[0],
      `for i in $(seq ${KEYS.length}); do (gpg --homedir ${gh} --batch --import /tmp/gpg-key-$i.gpg > ${gh}.i$i 2>&1; echo "rc=$?" >> ${gh}.i$i) & done`,
      `for i in $(seq ${READERS}); do (for j in 1; do gpg --homedir ${gh} --batch -k > ${gh}.r$i.k$j 2>&1; echo "rc=$?" >> ${gh}.r$i.k$j; gpg --homedir ${gh} --batch --list-keys --with-colons > ${gh}.r$i.c$j 2>&1; echo "rc=$?" >> ${gh}.r$i.c$j; done) & done`,
      'wait',
      `for f in ${gh}.i* ${gh}.r*; do echo "== $f"; cat $f; done`,
      `echo "== list"; GNUPGHOME=${gh} ${UIDS}`,
      `gpgconf --homedir ${gh} --kill gpg-agent`,
    ].join('\n'), { cwd: '/root' });
    const parts = out.split(/^== /m).slice(1);
    const imports = parts.filter((p) => p.startsWith(`${gh}.i`));
    const reads = parts.filter((p) => p.startsWith(`${gh}.r`));
    assert.equal(imports.length, KEYS.length, `readers round ${round}: ${KEYS.length} imports:\n${out}`);
    assert.equal(reads.length, READERS * 2, `readers round ${round}: ${READERS * 2} reads:\n${out}`);
    for (const part of imports) assert.match(part, /^rc=0$/m, `readers round ${round}: ${part.split('\n')[0]} exits 0:\n${out}`);
    for (const part of reads) {
      const name = part.split('\n')[0];
      assert.match(part, /^rc=0$/m, `readers round ${round}: ${name} exits 0 (2.4.9-9: keydb_search_next failed: Provided object is too short):\n${out}`);
      assert.doesNotMatch(part, /^gpg: .*(error|invalid|failed|too short|General)/im, `readers round ${round}: ${name} logs no error:\n${out}`);
      const uids = (part.match(/^uid[ :]/gm) ?? []).length;
      assert.ok(uids >= HELD.length, `readers round ${round}: ${name} lists at least the ${HELD.length} held keys (${uids}):\n${out}`);
    }
    const listed = new Set(out.match(/^uid tide\d+ <tide\d+@example\.test>$/gm) ?? []);
    assert.equal(listed.size, KEYS.length + HELD.length, `readers round ${round}: every key kept:\n${out}`);
  }

  // 3. Parallel --quick-gen-key in one homedir.
  for (const user of ['root', 'cone']) {
    const gh = `${user === 'root' ? '/root' : `/home/${user}`}/cg`;
    const out = await sh([
      `export GNUPGHOME=${gh}; rm -rf ${gh}; mkdir -m 700 -p ${gh}`,
      `for i in $(seq ${N}); do (${GEN('$i')} > ${gh}.$i.log 2>&1; echo "rc$i=$?" >> ${gh}.$i.log) & done; wait`,
      `for i in $(seq ${N}); do echo "== $i"; cat ${gh}.$i.log; done`,
      'echo "== list"', UIDS,
      'gpg --batch --check-trustdb > /dev/null 2>&1; echo "trustdb=$?"',
      'gpgconf --kill gpg-agent',
    ].join('\n'), { cwd: gh.replace(/\/cg$/, ''), ...(user === 'cone' && { user }) });
    assert.doesNotMatch(out, /Oops|lockfile|can't lock|not locked|lock '.*' not made|No agent running|invalid packet|keydb_search failed/i, `${user}: no lock or keybox errors:\n${out}`);
    const listed = new Set(out.match(/^uid U\d <u\d@example\.org>$/gm) ?? []);
    const runs = out.split(/^== /m).slice(1, N + 1);
    for (let i = 1; i <= N; i++) {
      assert.match(runs[i - 1], new RegExp(`^rc${i}=0$`, 'm'), `${user}: --quick-gen-key ${i} exits 0:\n${out}`);
      assert.ok(listed.has(`uid U${i} <u${i}@example.org>`), `${user}: key ${i} is in the keyring:\n${out}`);
    }
    assert.match(out, /^trustdb=0$/m, `${user}: --check-trustdb:\n${out}`);
  }
  const floor = ctx.installed?.[0]?.engines?.['slicc-kernel'];
  assert.equal(floor, '>=1.117.2', `engines.slicc-kernel is >=1.117.2: slicc.fcntl_lock (1.100.0) and renames atomic for other processes (slicc-kernel#925): ${floor}`);
  console.log(`concurrent: gpg waits for an fcntl holder of pubring.kbx.lock; ${KEYS.length} concurrent imports into a fresh homedir (3 rounds as root, 1 as cone), an existing empty keybox (1 round) and a keybox holding ${HELD.length} keys (3 rounds as root, 1 as cone) keep every key with no errors; after an import pubring.kbx has an inode number of its own and no tmp file is left, and ${READERS * 2} reads alongside ${KEYS.length} imports all succeed; ${N} parallel --quick-gen-key as root and cone all succeed`);
}
