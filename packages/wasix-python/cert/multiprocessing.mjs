const SCRIPT = String.raw`
import json, multiprocessing as mp, os, time
P = "/tmp/mp_counter"
def sq(x):
    return x * x
def bump(lock, n):
    for _ in range(n):
        with lock:
            x = int(open(P).read())
            time.sleep(0.002)
            open(P, "w").write(str(x + 1))
def feed(q):
    for i in range(3):
        q.put(i)
    q.put(None)
if __name__ == "__main__":
    out = {"start": mp.get_start_method()}
    ctx = mp.get_context("spawn")
    with ctx.Pool(2) as pool:
        out["pool"] = pool.map(sq, range(8))
    q = ctx.Queue()
    p = ctx.Process(target=feed, args=(q,))
    p.start()
    got = []
    while (x := q.get(timeout=30)) is not None:
        got.append(x)
    p.join()
    out["queue"] = [got, p.exitcode]
    open(P, "w").write("0")
    lock = ctx.Lock()
    ps = [ctx.Process(target=bump, args=(lock, 20)) for _ in range(3)]
    [p.start() for p in ps]
    [p.join() for p in ps]
    out["lock"] = [int(open(P).read()), [p.exitcode for p in ps]]
    s = ctx.Semaphore(2)
    out["sem"] = [s.acquire(timeout=1), s.acquire(timeout=1), s.acquire(timeout=0.2)]
    print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/mp_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/mp_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.start, 'spawn', JSON.stringify(out));
  assert.deepEqual(out.pool, [0, 1, 4, 9, 16, 25, 36, 49], JSON.stringify(out));
  assert.deepEqual(out.queue, [[0, 1, 2], 0], JSON.stringify(out));
  assert.deepEqual(out.lock, [60, [0, 0, 0]], `a Lock must serialise 3 processes x 20 read-sleep-write rounds: ${JSON.stringify(out)}`);
  assert.deepEqual(out.sem, [true, true, false], JSON.stringify(out));
  console.log('multiprocessing (spawn): Pool(2).map, a Queue fed by a child, a Lock serialising 3 processes x 20 file-counter rounds (60), Semaphore(2) gives two acquires then a timeout');
}
