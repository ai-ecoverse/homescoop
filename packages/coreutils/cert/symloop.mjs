/**
 * Symlink budget (homescoop#461): a path that needs 40 symlink follows
 * resolves, the 41st follow is ELOOP, as on Linux (MAXSYMLINKS) and in
 * slicc-kernel's own walks (slicc-kernel#700). Emscripten's FS.lookupPath
 * ran 40 passes, the first following nothing, so until 9.12.0-7 cat of a
 * 40-link chain said "Symbolic link loop" (musl's ELOOP text)
 * (scripts/emsdk-patches/libfs-symloop.patch).
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  // /c/l0 → /c/l1 → … → /c/l<n-1> → /f: n follows.
  const chain = (dir, n) =>
    `rm -rf ${dir} && mkdir -p ${dir} && printf E > ${dir}.f && for i in $(seq 0 ${n - 2}); do ln -s ${dir}/l$((i+1)) ${dir}/l$i; done && ln -s ${dir}.f ${dir}/l${n - 1}`;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    return { ...r, all: `${script}\nrc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}` };
  };
  for (const n of [39, 40]) {
    const r = await sh(`${chain(`/tmp/c${n}`, n)} && cat /tmp/c${n}/l0 && stat -L -c %s /tmp/c${n}/l0 && readlink -f /tmp/c${n}/l0`);
    assert.equal(r.status, 0, `${n} follows: ${r.all}`);
    assert.equal(r.stdout, `E1\n/tmp/c${n}.f\n`, `${n} follows: cat, stat -L and readlink -f reach the file: ${r.all}`);
  }
  const over = await sh(`${chain('/tmp/c41', 41)} && cat /tmp/c41/l0; echo "rc=$?"; stat -L /tmp/c41/l0 >/dev/null; echo "rc=$?"`);
  assert.match(over.stdout, /^rc=1\nrc=1\n$/, `41 follows: ${over.all}`);
  assert.match(over.stderr, /cat: \/tmp\/c41\/l0: Symbolic link loop/, over.all);
  // One link short of the budget from a relative start, through a directory link.
  const rel = await sh(`${chain('/tmp/cr', 39)} && mkdir -p /tmp/rd && ln -sfn /tmp/cr /tmp/rd/d && cd /tmp/rd && cat d/l0`);
  assert.equal(rel.status, 0, `a directory link plus 39: ${rel.all}`);
  assert.equal(rel.stdout, 'E', rel.all);
  console.log('symloop: 39 and 40 follows resolve (cat, stat -L, readlink -f), the 41st is ELOOP; a directory link plus 39 resolves');
}
