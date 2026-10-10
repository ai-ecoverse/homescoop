/**
 * bash umask reaches the kernel (5.3.0-10). Emscripten 4.0.23 keeps umask in
 * wasm; 5.3.0-8/-9 lost the env.__syscall_umask import that slicc-kernel
 * wraps (kernelUmask, #208), so `umask 077` stayed inside bash.
 * shims/slicc/slicc_umask.c restores the import.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/bash-umask';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd });
    assert.equal(r.status, 0, `${script}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };
  // bash's own create, and the kernel's view of bash's umask.
  assert.equal(await sh('umask 077; : > f1; stat -c %a f1; while read -r k v; do [[ $k == Umask: ]] && echo "$v"; done < /proc/self/status; :'), '600\n0077\n');
  // A child bash inherits it; a coreutils child creates with it.
  assert.equal(await sh('umask 077; bash -c umask'), '0077\n');
  assert.equal(await sh('umask 027; touch f2; mkdir d2; stat -c %a f2 d2'), '640\n750\n');
  // A WASIX child (perl) after umask 077: 0666 & ~077 = 600.
  assert.equal(await sh(`umask 077; perl -e 'open my $f, ">", "f3" or die; close $f'; stat -c %a f3`), '600\n');
  // umask reports what was set, and a subshell's umask does not leak back.
  assert.equal(await sh('umask 022; (umask 077; : > f4); : > f5; stat -c %a f4 f5; umask'), '600\n644\n0022\n');
}
