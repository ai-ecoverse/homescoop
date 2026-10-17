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
 * 3. Four parallel --quick-gen-key runs in one homedir: all succeed and
 *    keep their keys, --check-trustdb is clean. No tolerance for unlocked
 *    keybox reads: renames are atomic for other processes since
 *    slicc-kernel 1.117.2 (slicc-kernel#925, homescoop#934).
 */
const N = 4;

// Six distinct public keys (ed25519, uids tide1 … tide6 <tideN@example.test>).
const KEYS = [
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

  // 2. Six concurrent imports of distinct keys into a fresh homedir.
  await addUser({ name: 'cone' });
  await write('/tmp/gpg-keys.b64', KEYS.join('\n') + '\n');
  await sh(`i=0; while read -r k; do i=$((i + 1)); echo "$k" | base64 -d > /tmp/gpg-key-$i.gpg; done < /tmp/gpg-keys.b64; chmod 644 /tmp/gpg-key-*.gpg`);
  const rounds = [['root', 1], ['root', 2], ['root', 3], ['cone', 4]];
  for (const [user, round] of rounds) {
    const gh = `${user === 'root' ? '/root' : `/home/${user}`}/imp${round}`;
    const out = await sh([
      `rm -rf ${gh} ${gh}.*.log; mkdir -m 700 -p ${gh}`,
      `for i in $(seq ${KEYS.length}); do (gpg --homedir ${gh} --batch --import /tmp/gpg-key-$i.gpg > ${gh}.$i.log 2>&1; echo "rc$i=$?" >> ${gh}.$i.log) & done; wait`,
      `for i in $(seq ${KEYS.length}); do echo "== $i"; cat ${gh}.$i.log; done`,
      `echo "== list"; GNUPGHOME=${gh} ${UIDS}`,
      `gpgconf --homedir ${gh} --kill gpg-agent`,
    ].join('\n'), { cwd: gh.replace(/\/imp\d$/, ''), ...(user === 'cone' && { user }) });
    const runs = out.split(/^== /m).slice(1, KEYS.length + 1);
    for (let i = 1; i <= KEYS.length; i++) {
      assert.match(runs[i - 1], new RegExp(`^rc${i}=0$`, 'm'), `${user} round ${round}: import ${i} exits 0:\n${out}`);
      assert.doesNotMatch(runs[i - 1], /error|invalid|failed|Oops|lockfile|can't lock|not locked/i, `${user} round ${round}: import ${i} logs no error:\n${out}`);
    }
    const listed = new Set(out.match(/^uid tide\d <tide\d@example\.test>$/gm) ?? []);
    assert.equal(listed.size, KEYS.length, `${user} round ${round}: all ${KEYS.length} keys kept:\n${out}`);
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
  console.log(`concurrent: gpg waits for an fcntl holder of pubring.kbx.lock; ${KEYS.length} concurrent imports into a fresh homedir, 3 rounds as root and 1 as cone, keep every key with no errors; ${N} parallel --quick-gen-key as root and cone all succeed`);
}
