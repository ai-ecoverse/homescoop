/**
 * fcntl.flock (3.14.2-26): libc's flock through slicc.flock (wasix-sysroot
 * -34, slicc-kernel 1.117.0), per open file description. Up to 3.14.2-25
 * build.sh wrapped flock to a no-op (lock_stubs.c), so a second process's
 * LOCK_EX|LOCK_NB was granted while the first held LOCK_EX.
 * Run on slicc-kernel 1.120.2 (cert/meta.json extra_kernels).
 */
const SCRIPT = String.raw`
import fcntl, json, os, subprocess, sys
P = "/tmp/py-flock"
open(P, "a").close()
TRY = "import fcntl, sys\nf = open(sys.argv[1], sys.argv[2])\ntry:\n    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)\n    print('granted')\nexcept BlockingIOError:\n    print('refused')\n"
other = lambda mode: subprocess.run([sys.executable, "-c", TRY, P, mode], capture_output=True, text=True).stdout.strip()
out = {}
f = open(P, "a")
fcntl.flock(f, fcntl.LOCK_EX)
out["rw"] = other("a")
fcntl.flock(f, fcntl.LOCK_UN)
out["rw_after_un"] = other("a")
ro = open(P, "r")
fcntl.flock(ro, fcntl.LOCK_EX)
out["readonly"] = other("r")
ro.close()
out["after_close"] = other("r")
r, w = os.pipe()
fcntl.flock(w, fcntl.LOCK_EX)
try:
    fcntl.flock(r, fcntl.LOCK_EX | fcntl.LOCK_NB)
    out["pipe_other_end"] = "granted"
except BlockingIOError:
    out["pipe_other_end"] = "refused"
d = os.dup(w)
try:
    fcntl.flock(d, fcntl.LOCK_EX | fcntl.LOCK_NB)
    out["pipe_dup"] = "granted"
except BlockingIOError:
    out["pipe_dup"] = "refused"
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/py_flock.py', SCRIPT);
  const r = await run(['python3', '/tmp/py_flock.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, { rw: 'refused', rw_after_un: 'granted', readonly: 'refused', after_close: 'granted', pipe_other_end: 'refused', pipe_dup: 'granted' }, r.stdout);
  console.log(`fcntl.flock through slicc.flock: a second process's LOCK_EX|LOCK_NB is refused while the first holds LOCK_EX and granted after LOCK_UN; LOCK_EX on a read-only file excludes another read-only open until close; a pipe's other end is refused, a dup of the locked end shares it`);
}
