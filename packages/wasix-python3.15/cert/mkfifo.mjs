/**
 * os.mkfifo (3.14.2-28, homescoop#1018): libc's mkfifo through
 * slicc_fs.path_mkfifo (wasix-sysroot -34, slicc-kernel 1.120.0). Since -26
 * configure finds it, so os.mkfifo exists; -26/-27 declared slicc-kernel
 * >=1.100.0, and on kernels before 1.120.0 it is ENOSYS. -28's engines floor
 * is 1.120.0, the cert kernel 1.120.2.
 */
const SCRIPT = String.raw`
import json, os, stat, threading
p = "/tmp/py-fifo"
if os.path.exists(p):
    os.unlink(p)
os.umask(0o022)
os.mkfifo(p, 0o666)
st = os.stat(p)
try:
    os.mkfifo(p)
    again = "created"
except FileExistsError:
    again = "EEXIST"
def writer():
    with open(p, "w") as w:
        w.write("via fifo\n")
t = threading.Thread(target=writer)
t.start()
with open(p) as r:
    line = r.read().strip()
t.join()
os.unlink(p)
print(json.dumps({"fifo": stat.S_ISFIFO(st.st_mode), "mode": oct(st.st_mode & 0o777), "again": again, "read": line}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/py_fifo.py', SCRIPT);
  const r = await run(['python3', '/tmp/py_fifo.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, { fifo: true, mode: '0o644', again: 'EEXIST', read: 'via fifo' }, r.stdout);
  console.log(`os.mkfifo: a FIFO (0o666 under umask 022 -> 0o644), EEXIST on a second mkfifo, and a writer thread's line read through it`);
}
