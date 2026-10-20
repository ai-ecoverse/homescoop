export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'bob' });
  const r = await run(['bash', '--norc', '-c', 'mkdir -p /home/bob/m; mount -t tmpfs none /home/bob/m; echo own=$?; umount /home/bob/m; echo uown=$?; mount -t tmpfs none /etc; echo etc=$?'], { cwd: '/home/bob', user: 'bob' });
  assert.equal(r.stdout, 'own=0\nuown=0\netc=32\n', `${r.stdout}${r.stderr}`);
  assert.equal(r.stderr, "mount: /etc: Operation not permitted (not your mount point, or refused by the kernel's mount policy).\n", 'homescoop#666: 1.0.0-4 said "(process mounts are disabled here)"');
  const root = await run(['bash', '--norc', '-c', 'mkdir -p /tmp/rm && mount -t tmpfs none /tmp/rm && umount /tmp/rm && echo root-ok'], { cwd: '/tmp' });
  assert.equal(root.stdout, 'root-ok\n', root.stderr);
  console.log("eperm: bob mounts and unmounts his own directory; /etc is EPERM, reported as a mount point that isn't his or a policy refusal");
}
