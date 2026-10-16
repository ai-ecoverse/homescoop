const SCRIPT = String.raw`
import json, multiprocessing as mp, threading
from concurrent.futures import ProcessPoolExecutor
def inc(v, a):
    with v.get_lock():
        v.value += 5
    a[0] = 9
def cube(x):
    return x ** 3
def attempt(f):
    try:
        return ["ok", f()]
    except Exception as e:
        return [type(e).__name__, str(e)]
if __name__ == "__main__":
    out = {"methods": mp.get_all_start_methods(), "start": mp.get_start_method()}
    out["fork"] = attempt(lambda: mp.get_context("fork").get_start_method())
    out["forkserver"] = attempt(lambda: mp.get_context("forkserver").get_start_method())
    v = mp.Value("i", 1)
    a = mp.Array("i", [1, 2])
    p = mp.Process(target=inc, args=(v, a))
    def run():
        p.start()
        p.join()
        return p.exitcode
    out["value"] = [attempt(run), v.value, list(a)]
    t = mp.Value("i", 0)
    def bump():
        for _ in range(100):
            with t.get_lock():
                t.value += 1
    ts = [threading.Thread(target=bump) for _ in range(4)]
    [x.start() for x in ts]
    [x.join() for x in ts]
    out["threads"] = t.value
    def shm():
        from multiprocessing import shared_memory
        return shared_memory.SharedMemory(create=True, size=16).name
    out["shm"] = attempt(shm)
    from multiprocessing import managers
    out["has_shmem"] = managers.HAS_SHMEM
    with ProcessPoolExecutor(2) as ex:
        out["executor"] = list(ex.map(cube, range(5)))
    print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/mp_noshare.py', SCRIPT);
  const r = await run(['python3', '/tmp/mp_noshare.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.methods, ['spawn'], `get_all_start_methods must list only spawn (no os.fork): ${o}`);
  assert.equal(out.start, 'spawn', o);
  assert.equal(out.fork[0], 'ValueError', `get_context("fork") must raise ValueError: ${o}`);
  assert.equal(out.forkserver[0], 'ValueError', o);
  assert.equal(out.value[0][0], 'NotImplementedError', `passing a Value/Array to a child must raise, not lose its writes: ${o}`);
  assert.match(out.value[0][1], /Queue, a Pipe or a Manager/, o);
  assert.deepEqual(out.value.slice(1), [1, [1, 2]], o);
  assert.equal(out.threads, 400, `a Value shared by threads of one process still works: ${o}`);
  assert.equal(out.shm[0], 'ImportError', `multiprocessing.shared_memory must not import: ${o}`);
  assert.equal(out.has_shmem, false, o);
  assert.deepEqual(out.executor, [0, 1, 8, 27, 64], o);
  console.log('multiprocessing without shared memory: start methods [spawn], get_context("fork"/"forkserver") ValueError, a Value/Array passed to a child raises NotImplementedError at start(), a Value shared by 4 threads counts 400, shared_memory ImportError (managers.HAS_SHMEM False), ProcessPoolExecutor(2).map');
}
