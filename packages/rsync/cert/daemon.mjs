/**
 * rsync daemon over the kernel's sockets (netfork profile, 3.4.4-3): an
 * `rsync --daemon` on a kernel-local port, the module list, a push and a
 * pull through rsync://, and a port nobody listens on (refused, rc 10).
 * 3.4.4-2 linked no socket shim: its client hung on any rsync:// URL.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (s) => run(['bash', '-c', s], { cwd: '/home' });
  const setup = await sh(
    "mkdir -p /home/dsrv /home/dsrc/d && echo one > /home/dsrc/a && echo two > /home/dsrc/d/b && " +
      "printf 'use chroot = no\\npid file = /tmp/rsyncd.pid\\nlog file = /tmp/rsyncd.log\\n[mod]\\n  path = /home/dsrv\\n  comment = test module\\n  read only = false\\n' > /tmp/rsyncd.conf",
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
  const log = await run(['cat', '/tmp/rsyncd.log'], { cwd: '/home' });
  assert.match(log.stdout, /rsync allowed access on module mod from .*\(127\.0\.0\.1\)/);
}
