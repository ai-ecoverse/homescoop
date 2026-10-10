/**
 * wasix-python 3.14.2-14 (wasix-sysroot -21; slicc-kernel #248): asyncio
 * subprocess pipes. asyncio's pipe transports need the fd to be a pipe,
 * socket or character device. WASI has no FIFO filetype: -21's fstat takes
 * S_IFIFO from slicc_fs when the kernel reports it (slicc-kernel #307), and
 * 1.47.3-1.48.x report pipes as sockets (#280). On 1.47.1 a pipe was typeless
 * and asyncio refused it ("Pipe transport is only for pipes, sockets and
 * character devices").
 */
const SCRIPT = String.raw`
import asyncio, os, stat, sys
r, w = os.pipe()
m = os.fstat(r).st_mode
kind = "fifo" if stat.S_ISFIFO(m) else "socket" if stat.S_ISSOCK(m) else f"other:{oct(stat.S_IFMT(m))}"
os.close(r); os.close(w)
async def main():
    p = await asyncio.create_subprocess_exec("echo", "hi", stdout=asyncio.subprocess.PIPE)
    out, _ = await p.communicate()
    q = await asyncio.create_subprocess_exec("cat", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
    back, _ = await q.communicate(b"round trip\n")
    return out, p.returncode, back, q.returncode
out, rc, back, rc2 = asyncio.run(main())
print(kind, repr(out), rc, repr(back), rc2)
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/fifo_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/fifo_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  // fifo on a kernel with #307, socket on 1.47.3-1.48.x.
  assert.match(r.stdout.trim(), /^(fifo|socket) b'hi\\n' 0 b'round trip\\n' 0$/, r.stdout);
  console.log(`fifo: pipe type ${r.stdout.trim().split(' ')[0]}`);
}
