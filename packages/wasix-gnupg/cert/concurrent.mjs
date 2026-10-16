/**
 * Concurrent gpg runs on one homedir (homescoop#712). gnupg's dotlock takes
 * <file>.lock with link() + st_nlink, and slicc-kernel's OPFS root has no
 * hard links (slicc-kernel#563), so up to 2.4.9-7 it fell back to an O_EXCL
 * lock file that raced: of four parallel --quick-gen-key runs in one homedir
 * some logged "Oops, '…/pubring.kbx.lock' is not locked" / "error reading
 * lockfile" / "lockfile disappeared" and lost their key. Since 2.4.9-8
 * dotlock on WASI holds an fcntl write lock on the lock file
 * (slicc.fcntl_lock, slicc-kernel >= 1.100.0), which the kernel releases
 * when its holder exits.
 *
 * 1. Exclusion, deterministically: a ruby process holds an fcntl write lock
 *    on pubring.kbx.lock; gpg must say "waiting for lock" and write its key
 *    only after the release.
 * 2. Four parallel --quick-gen-key runs, as root and as cone: no lock errors,
 *    and every run that succeeded has its key in the keyring. A run may
 *    still fail an unlocked read of the keybox (keydb_search: "No such file
 *    or directory", or "invalid packet"): a WASIX process's rename over a
 *    file isn't atomic for other processes in slicc-kernel 1.106.2
 *    (ai-ecoverse/slicc-kernel#903), and gpg reads the keybox without the
 *    lock while another gpg renames its update into place. Such a run fails
 *    cleanly and writes nothing; the spec counts it and logs it.
 */
const N = 4;

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

  // 2. Parallel runs in one homedir.
  await addUser({ name: 'cone' });
  let raced = 0;
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
    assert.doesNotMatch(out, /Oops|lockfile|can't lock|not locked|lock '.*' not made|No agent running/i, `${user}: no lock errors:\n${out}`);
    const listed = new Set(out.match(/^uid U\d <u\d@example\.org>$/gm) ?? []);
    const runs = out.split(/^== /m).slice(1, N + 1);
    for (let i = 1; i <= N; i++) {
      const ok = new RegExp(`^rc${i}=0$`, 'm').test(runs[i - 1]);
      if (ok) assert.ok(listed.has(`uid U${i} <u${i}@example.org>`), `${user}: run ${i} succeeded, so its key is in the keyring:\n${out}`);
      else {
        assert.match(runs[i - 1], /keydb_search failed: No such file or directory|invalid packet|already exists/, `${user}: run ${i} failed only on an unlocked keybox read (slicc-kernel rename):\n${out}`);
        raced += 1;
      }
    }
    assert.match(out, /^trustdb=0$/m, `${user}: --check-trustdb:\n${out}`);
  }
  const floor = ctx.installed?.[0]?.engines?.['slicc-kernel'];
  assert.equal(floor, '>=1.100.0', `engines.slicc-kernel is >=1.100.0, the first kernel with slicc.fcntl_lock: ${floor}`);
  console.log(`concurrent: gpg waits for an fcntl holder of pubring.kbx.lock; ${N} parallel --quick-gen-key in one homedir, as root and cone: no lock errors, every successful run's key kept (${raced} run(s) hit the unlocked-read rename race)`);
}
