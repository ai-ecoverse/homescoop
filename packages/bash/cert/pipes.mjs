/**
 * Pipes and close-on-exec (5.3.0-10). Emscripten 4.0.23 leaves pipe2
 * unimplemented (musl falls back to pipe + fcntl FD_CLOEXEC); a pipe write
 * end leaking into a child would keep a pipeline from ever seeing EOF.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/bash-pipes';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd });
    assert.equal(r.status, 0, `${script}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };
  // The reader sees EOF once the subshell's writer exits.
  assert.equal(await sh('(sleep 0.2; echo x) | cat'), 'x\n');
  assert.equal(await sh('printf "a\\nb\\n" | (read -r l; echo "got $l"; cat)'), 'got a\nb\n');
  // A pipeline child holds only 0, 1, 2 (no stray pipe ends); 3 is ls's own
  // handle on /proc/self/fd while it reads it, as on Linux.
  const fds = (await sh('echo | ls /proc/self/fd | sort -n | tr "\\n" " "')).trim();
  assert.equal(fds, '0 1 2 3', `pipeline child fds: ${fds}`);
  // exec 3>&1 in the shell: a child inherits fd 3 (no CLOEXEC on a dup), and
  // the shell's own internal fds (cloexec) are not listed.
  const kept = (await sh('exec 3>&1; ls /proc/self/fd | sort -n | tr "\\n" " "')).trim();
  assert.equal(kept, '0 1 2 3 4', `child fds after exec 3>&1 (4 is ls's own): ${kept}`);
  // A long pipeline terminates and passes data through.
  assert.equal(await sh('seq 1 2000 | cat | cat | tail -1'), '2000\n');
}
