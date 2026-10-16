/**
 * rsync daemon over the kernel's sockets (netfork profile, 3.4.4-3): an
 * `rsync --daemon` on a kernel-local port, the module list, a push and a
 * pull through rsync://, and a port nobody listens on (refused, rc 10).
 * 3.4.4-2 linked no socket shim: its client hung on any rsync:// URL.
 *
 * Client names (3.5.1-3, homescoop#176): the daemon's reverse lookup of a
 * loopback client answers localhost (the socket shim's getnameinfo, from
 * /etc/hosts), so the log says "connect from localhost (127.0.0.1)" and
 * `hosts allow = localhost` / `hosts deny = localhost` match by name. Until
 * 3.5.1-2 the lookup failed ("name lookup failed for 127.0.0.1"), the client
 * was UNKNOWN, and the named allow refused it.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (s) => run(['bash', '-c', s], { cwd: '/home' });
  const setup = await sh(
    "mkdir -p /home/dsrv /home/dsrc/d && echo one > /home/dsrc/a && echo two > /home/dsrc/d/b && " +
      "printf 'use chroot = no\\nuid = root\\ngid = root\\npid file = /tmp/rsyncd.pid\\nlog file = /tmp/rsyncd.log\\n[mod]\\n  path = /home/dsrv\\n  comment = test module\\n  read only = false\\n" +
      "[lh]\\n  path = /home/dsrc\\n  hosts allow = localhost\\n  hosts deny = *\\n[nolh]\\n  path = /home/dsrc\\n  hosts deny = localhost\\n' > /tmp/rsyncd.conf",
  );
  assert.equal(setup.status, 0, setup.stderr);
  const r = await sh([
    'rsync --daemon --no-detach --config=/tmp/rsyncd.conf --port=8730 & d=$!',
    'for i in 1 2 3 4 5 6 7 8 9 10; do [ -s /tmp/rsyncd.pid ] && break; sleep 0.3; done; sleep 0.3',
    'echo "== list"; timeout 20 rsync rsync://127.0.0.1:8730/; echo "list rc=$?"',
    'echo "== push"; timeout 20 rsync -a /home/dsrc/ rsync://127.0.0.1:8730/mod/; echo "push rc=$?"',
    'echo "== pull"; timeout 20 rsync -a rsync://localhost:8730/mod/ /home/dback/; echo "pull rc=$?"',
    'echo "content $(cat /home/dback/a /home/dback/d/b | tr "\\n" " ")"',
    'echo "== refused"; timeout 20 rsync rsync://127.0.0.1:8731/ 2>&1; echo "refused rc=$?"',
    'echo "== allow by name"; timeout 20 rsync -a rsync://127.0.0.1:8730/lh/ /home/dlh/ 2>&1; echo "allow rc=$?"; cat /home/dlh/a',
    'echo "== deny by name"; timeout 20 rsync -a rsync://127.0.0.1:8730/nolh/ /home/dnolh/ 2>&1; echo "deny rc=$?"',
    'kill $d; wait $d 2>/dev/null; echo done',
  ].join('\n'));
  const out = r.stdout;
  assert.equal(r.status, 0, `daemon session rc=${r.status} stderr=${r.stderr}`);
  assert.match(out, /^mod\s+\ttest module$/m, `module list: ${out}`);
  assert.match(out, /^list rc=0$/m);
  assert.match(out, /^push rc=0$/m, `push: ${out} ${r.stderr}`);
  assert.match(out, /^pull rc=0$/m, `pull: ${out} ${r.stderr}`);
  assert.match(out, /^content one two $/m);
  assert.match(out, /failed to connect to 127\.0\.0\.1 \(127\.0\.0\.1\): Connection refused/);
  assert.match(out, /^refused rc=10$/m);
  assert.match(out, /^allow rc=0\none$/m, `hosts allow = localhost from 127.0.0.1: ${out}`);
  assert.match(out, /@ERROR: access denied to nolh from localhost \(127\.0\.0\.1\)/, `hosts deny = localhost: ${out}`);
  assert.match(out, /^deny rc=5$/m, out);
  const log = await run(['cat', '/tmp/rsyncd.log'], { cwd: '/home' });
  assert.match(log.stdout, /rsync allowed access on module mod from localhost \(127\.0\.0\.1\)/, log.stdout);
  assert.match(log.stdout, /connect from localhost \(127\.0\.0\.1\)/, log.stdout);
  assert.doesNotMatch(log.stdout, /name lookup failed|UNKNOWN/, log.stdout);
  console.log('daemon: module list, push, pull, refused port; clients are localhost (127.0.0.1): hosts allow = localhost lets them in, hosts deny = localhost keeps them out');
}
