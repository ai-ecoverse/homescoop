const SCRIPT = String.raw`
import json, threading
out = {"has": hasattr(threading, "get_native_id")}
main = threading.get_native_id()
out["main"] = [main == threading.main_thread().native_id, isinstance(main, int) and main > 0]
seen, ready, go = {}, threading.Barrier(3), threading.Event()
def worker(k):
    seen[k] = [threading.get_native_id(), threading.current_thread().native_id]
    ready.wait()
    go.wait()
ts = [threading.Thread(target=worker, args=(k,)) for k in (0, 1)]
[t.start() for t in ts]
ready.wait()
ids = [seen[0][0], seen[1][0]]
out["threads"] = [seen[0][0] == seen[0][1], seen[1][0] == seen[1][1], len({main, *ids}) == 3, [t.native_id for t in ts] == ids]
go.set()
[t.join() for t in ts]
print(json.dumps(out))
`;

const SCIPY = String.raw`
import json, scipy.fft as f
with f.set_backend("scipy"):
    a = f.fft([1.0, 2.0, 3.0])
with f.skip_backend("scipy"):
    pass
print(json.dumps([[round(z.real, 3) + 0.0, round(z.imag, 3) + 0.0] for z in a]))
`;
const SITE = (p) => `/node_modules/@ai-ecoverse/${p}/lib/python3.14/site-packages`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/native_id.py', SCRIPT);
  const r = await run(['python3', '/tmp/native_id.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.has, true, `threading.get_native_id must exist (homescoop#587): ${o}`);
  assert.deepEqual(out.main, [true, true], o);
  assert.deepEqual(out.threads, [true, true, true, true], `two live threads and the main thread have three distinct native ids, each matching Thread.native_id: ${o}`);
  await write('/tmp/native_id_scipy.py', SCIPY);
  const s = await run(['python3', '/tmp/native_id_scipy.py'], { cwd: '/tmp', env: { PYTHONPATH: `${SITE('py-numpy')}:${SITE('py-scipy')}` } });
  assert.equal(s.status, 0, `scipy.fft.set_backend/skip_backend (uarray keys its state by threading.get_native_id): rc=${s.status} stderr=${s.stderr}`);
  assert.deepEqual(JSON.parse(s.stdout.trim().split('\n').pop()), [[6, 0], [-1.5, 0.866], [-1.5, -0.866]], s.stdout);
  console.log('threading.get_native_id: the main thread\'s id matches main_thread().native_id; two live threads get distinct ids, each equal to their Thread.native_id; scipy.fft.set_backend("scipy") and skip_backend work (fft [6, -1.5+0.866j, -1.5-0.866j])');
}
