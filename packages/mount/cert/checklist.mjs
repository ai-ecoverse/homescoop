/**
 * mount / umount checklist. Needs a slicc-kernel with process mounts
 * (slicc-kernel#92): Module.sliccKernel.mount/umount2, `nomedium` in
 * /proc/mounts and ENOMEDIUM (148) from the FS layer.
 *
 * Mounts are kernel-wide, so they outlive each one-shot `run`. The harness
 * page has no hostfs grant hook; hostfs is only checked for its refusal.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (script) => run(['bash', '-c', script], { cwd: '/home' });
  const ok = (r, what) => assert.equal(r.status, 0, `${what}: rc=${r.status} stderr=${r.stderr}`);

  const mk = await run(['mkdir', '-p', '/mnt/t', '/mnt/f', '/mnt/r', '/mnt/b'], { cwd: '/home' });
  ok(mk, 'mkdir /mnt/*');

  // tmpfs: mount, write, read back.
  ok(await run(['mount', '-t', 'tmpfs', 'none', '/mnt/t']), 'mount -t tmpfs');
  const rw = await sh('echo hello-tmpfs > /mnt/t/x && cat /mnt/t/x');
  ok(rw, 'write to tmpfs');
  assert.equal(rw.stdout, 'hello-tmpfs\n');

  // fsa without a folder yet: the mount succeeds in the nomedium state.
  ok(await run(['mount', '-t', 'fsa', 'none', '/mnt/f']), 'mount -t fsa');

  // `mount` lists both, and says the fsa drive has no medium.
  const list = await run(['mount']);
  ok(list, 'mount (list)');
  assert.match(list.stdout, /^\S+ on \/mnt\/t type tmpfs \(/m, `tmpfs missing:\n${list.stdout}`);
  assert.match(
    list.stdout,
    /^\S+ on \/mnt\/f type fsa \([^)]*\bnomedium\b[^)]*\)$/m,
    `fsa nomedium missing:\n${list.stdout}`,
  );
  const fsaOnly = await run(['mount', '-t', 'fsa']);
  ok(fsaOnly, 'mount -t fsa (list)');
  assert.doesNotMatch(fsaOnly.stdout, /type tmpfs/, `-t filter:\n${fsaOnly.stdout}`);

  // The empty drive's root is a listable, empty directory; below it there is
  // no medium yet (ENOMEDIUM from the kernel's FS layer).
  const ls = await run(['ls', '-A', '/mnt/f'], { cwd: '/home' });
  ok(ls, 'ls /mnt/f (nomedium root)');
  assert.equal(ls.stdout, '', `nomedium root should be empty, got ${JSON.stringify(ls.stdout)}`);
  for (const argv of [['cat', '/mnt/f/x'], ['ls', '/mnt/f/x']]) {
    const r = await run(argv, { cwd: '/home' });
    assert.notEqual(r.status, 0, `${argv.join(' ')} should fail, stdout=${r.stdout}`);
    assert.match(r.stderr, /No medium found/, `${argv.join(' ')} stderr=${r.stderr}`);
  }

  // umount the tmpfs: listing and contents are gone.
  ok(await run(['umount', '/mnt/t']), 'umount /mnt/t');
  const after = await run(['mount']);
  ok(after, 'mount after umount');
  assert.doesNotMatch(after.stdout, / on \/mnt\/t /, `tmpfs still listed:\n${after.stdout}`);
  const gone = await run(['ls', '/mnt/t/x'], { cwd: '/home' });
  assert.notEqual(gone.status, 0, 'file on unmounted tmpfs still visible');

  // umount -l (MNT_DETACH) the fsa drive.
  ok(await run(['umount', '-l', '/mnt/f']), 'umount -l /mnt/f');
  const after2 = await run(['mount']);
  assert.doesNotMatch(after2.stdout, / on \/mnt\/f /, `fsa still listed:\n${after2.stdout}`);

  // Bad fstype: error, rc != 0.
  const bad = await run(['mount', '-t', 'nosuchfs', 'none', '/mnt/b']);
  assert.notEqual(bad.status, 0, 'bad fstype should fail');
  assert.match(bad.stderr, /unknown filesystem type 'nosuchfs'/, `bad fstype stderr=${bad.stderr}`);

  // -o ro is enforced (EROFS on write).
  ok(await run(['mount', '-t', 'tmpfs', '-o', 'ro', 'none', '/mnt/r']), 'mount -o ro');
  const ro = await sh('echo x > /mnt/r/y');
  assert.notEqual(ro.status, 0, 'write to ro tmpfs should fail');
  assert.match(ro.stderr, /Read-only file system/, `ro write stderr=${ro.stderr}`);
  ok(await run(['umount', '/mnt/r']), 'umount /mnt/r');

  // Bad option value: EINVAL.
  const badOpt = await run(['mount', '-t', 'tmpfs', '-o', 'maxfile=xyz', 'none', '/mnt/b']);
  assert.notEqual(badOpt.status, 0, 'maxfile=xyz should fail');
  assert.match(badOpt.stderr, /bad option/, `bad option stderr=${badOpt.stderr}`);

  // Refused targets and non-mounts.
  const root = await run(['mount', '-t', 'tmpfs', 'none', '/proc']);
  assert.notEqual(root.status, 0, 'mount over /proc should fail');
  assert.match(root.stderr, /busy/, `mount /proc stderr=${root.stderr}`);
  const notMounted = await run(['umount', '/mnt/b']);
  assert.notEqual(notMounted.status, 0, 'umount of a plain dir should fail');
  assert.match(notMounted.stderr, /not mounted/, `umount /mnt/b stderr=${notMounted.stderr}`);

  // hostfs without a grant hook (this harness): refused, not hung.
  const host = await run(['mount', '-t', 'hostfs', '/tmp', '/mnt/b']);
  assert.notEqual(host.status, 0, 'hostfs without a hook should fail');
  assert.match(host.stderr, /hostfs is not available/, `hostfs stderr=${host.stderr}`);
}
