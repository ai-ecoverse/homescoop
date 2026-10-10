/**
 * homescoop#169 — run test/modes.c (built against this sysroot) under the
 * kernel and read the modes it set from outside. With slicc_fs
 * (slicc-kernel#208): the exact modes, read back the same inside WASIX.
 * Without it: the upstream no-op behaviour, and nothing fails.
 *
 * Build: wasixcc -O2 test/modes.c -o <pkg>/bin/modes.wasm (SYSROOT_PREFIX =
 * this package, plus lib/wasm32-wasi -> wasm32-wasip1), as a package whose
 * slicc.commands.modes is bin/modes.wasm.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/modes';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const r = await run(['modes', cwd], { cwd });
  assert.equal(r.status, 0, `modes rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const native = /^slicc_fs native$/m.test(r.stdout);
  if (ctx.requireNative) assert.ok(native, `the kernel has no slicc_fs imports:\n${r.stdout}`);
  const files = ['grp', 'secret', 'excl', 'private', 'private/key', 'pub', 'exec', 'sub', 'sub/inner'];
  const st = await run(['stat', '-c', '%a', ...files], { cwd });
  assert.equal(st.status, 0, `stat stderr=${st.stderr}`);
  const got = Object.fromEntries(files.map((f, i) => [f, st.stdout.split('\n')[i]]));
  if (native) {
    assert.match(r.stdout, /^umask old=022$/m);
    assert.deepEqual(got, {
      grp: '640', secret: '600', excl: '640', private: '700', 'private/key': '600',
      pub: '644', exec: '755', sub: '755', 'sub/inner': '700',
    });
    assert.match(r.stdout, /^nofollow link: (Operation )?[Nn]ot supported$/m);
    assert.match(r.stdout, /^chmod missing: No such file or directory$/m);
    // Read back inside WASIX: the same bits coreutils sees.
    for (const [f, m] of Object.entries(got)) assert.match(r.stdout, new RegExp(`^stat ${f} ${m}$`, 'm'), `inside stat ${f}`);
    assert.match(r.stdout, /^fstat secret 600$/m);
    assert.match(r.stdout, /^lstat link symlink$/m);
  } else {
    // Older kernel: imports answer ENOSYS, libc keeps a local umask.
    assert.match(r.stdout, /^slicc_fs absent$/m);
    assert.match(r.stdout, /^umask old=022$/m);
    assert.match(r.stdout, /^nofollow link: ok$/m);
    assert.match(r.stdout, /^chmod missing: ok$/m);
    // No mode bits inside WASIX without fd_mode / path_mode.
    assert.match(r.stdout, /^stat secret 000$/m);
  }
}
