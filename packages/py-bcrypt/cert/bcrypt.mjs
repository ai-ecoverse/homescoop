// hashpw/checkpw/gensalt/kdf against known answers (pyca/bcrypt 5.0.0 on
// CPython, same inputs), random salts (getrandom's WASI random_get), and
// the error paths: bad salts, rounds and types are Python exceptions, not a
// panic=abort trap.
const SCRIPT = String.raw`
import json, threading, warnings
import bcrypt
out = {"version": bcrypt.__version__}
out["hashpw"] = bcrypt.hashpw(b"password", b"$2b$04$KLMNOPQRSTUVWXYZabcdeu").decode()
out["2a"] = bcrypt.hashpw(b"password", b"$2a$04$KLMNOPQRSTUVWXYZabcdeu").decode()
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    out["kdf4"] = bcrypt.kdf(b"password", b"salt", 32, 4).hex()
out["kdf50"] = bcrypt.kdf(b"password", b"salt", 32, 50).hex()
salts = {bcrypt.gensalt(rounds=4) for _ in range(20)}
out["salts"] = [len(salts), sorted({s[:7].decode() for s in salts})]
h = bcrypt.hashpw(b"secret", bcrypt.gensalt(rounds=4))
out["check"] = [bcrypt.checkpw(b"secret", h), bcrypt.checkpw(b"Secret", h)]
out["prefix"] = bcrypt.gensalt(prefix=b"2a")[:4].decode()
def err(f):
    try:
        f(); return "accepted"
    except Exception as e:
        return type(e).__name__
out["errors"] = [
    err(lambda: bcrypt.hashpw(b"x", b"$2b$99$broken")),
    err(lambda: bcrypt.gensalt(rounds=2)),
    err(lambda: bcrypt.gensalt(prefix=b"3x")),
    err(lambda: bcrypt.hashpw("str", bcrypt.gensalt())),
    err(lambda: bcrypt.checkpw(b"x", b"not a hash")),
    err(lambda: bcrypt.kdf(b"", b"salt", 32, 4)),
]
res, bad = [], []
def work(i):
    try:
        hh = bcrypt.hashpw(b"t%d" % i, bcrypt.gensalt(rounds=4)); assert bcrypt.checkpw(b"t%d" % i, hh); res.append(i)
    except Exception as e:
        bad.append(repr(e))
ts = [threading.Thread(target=work, args=(i,)) for i in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
out["threads"] = [sorted(res), bad]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/bcrypt_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/bcrypt_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.version, '5.0.0', o);
  assert.equal(out.hashpw, '$2b$04$KLMNOPQRSTUVWXYZabcdeu8iHYBzzjBZGweLxpoAKYtGY2q.pI.Gq', o);
  assert.ok(out['2a'].startsWith('$2a$04$KLMNOPQRSTUVWXYZabcde'), o);
  assert.equal(out.kdf4, '5bbf0cc293587f1c3635555c27796598d47e579071bf427e9d8fbe842aba34d9', o);
  assert.equal(out.kdf50, '3dc41515cffe5b3d0ad3bddff7a9f1de0eafb5077b782dc99d2fca840a7bdebc', o);
  assert.deepEqual(out.salts, [20, ['$2b$04$']], `20 random salts, all different: ${o}`);
  assert.deepEqual(out.check, [true, false], o);
  assert.equal(out.prefix, '$2a$', o);
  assert.deepEqual(out.errors, ['ValueError', 'ValueError', 'ValueError', 'TypeError', 'ValueError', 'ValueError'], o);
  assert.deepEqual(out.threads, [[0, 1, 2, 3], []], o);
  console.log('bcrypt 5.0.0: hashpw and kdf (4 and 50 rounds) give CPython bcrypt 5.0.0\'s answers; 20 gensalt() salts all differ (random_get); checkpw accepts the password and refuses another; a bad salt, rounds, prefix, a str password, a non-hash and an empty kdf password raise ValueError/TypeError; 4 threads hash and check at once');
}
