/**
 * wasix-python 3.14.2-12 (homescoop#181): the built-in C modules against
 * known answers. hashlib/hmac (HACL* and OpenSSL 3.5.9), zlib/bz2/lzma
 * round trips, a TLS 1.3 handshake between two ssl.SSLObjects over memory
 * BIOs (self-signed P-256 cert below, valid to 2126), RAND, sqlite3
 * (3.53.4, -11's compile options), threads, subprocess (posix_spawn),
 * select on a pipe. ctypes is reported, not asserted (no _ctypes, as -11).
 */
const CERT = `-----BEGIN CERTIFICATE-----
MIIBdTCCARqgAwIBAgIUYJ691OXDq1hZBNBhaN/YMEQ7xSMwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAxMDA3MDgyM1oYDzIxMjYwOTE2
MDcwODIzWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARJwxbH7MINLJoqFMJqTjprPiDugBm32Vkz/9WRyXJY07J4tRrwan8s
TpKOQ1iBEwKHq6xZWGMgahj9miwuS+pSo0gwRjAdBgNVHQ4EFgQUlpXZxJWrG9AD
O7b4jiSGXnj81gwwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhv
c3QwCgYIKoZIzj0EAwIDSQAwRgIhAOzlluYVaspdzMa/K970Fu+TnoBS0Bn4Vemb
wCnwZgMkAiEA+kkuQQK9po1LI7eH+erWBGGGeRCzEGjhvCuupBCs0a0=
-----END CERTIFICATE-----`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQglRtxRns4EBAnNmgS
syLxFKwJonViFxYA7+1G7WhTtP+hRANCAARJwxbH7MINLJoqFMJqTjprPiDugBm3
2Vkz/9WRyXJY07J4tRrwan8sTpKOQ1iBEwKHq6xZWGMgahj9miwuS+pS
-----END PRIVATE KEY-----`;

const SCRIPT = String.raw`
import hashlib, hmac, zlib, bz2, lzma, ssl, sqlite3, threading, subprocess, select, os, sys, json
from concurrent.futures import ThreadPoolExecutor
out = {}
d = b"abc"
out["hash"] = [hashlib.md5(d).hexdigest(), hashlib.sha1(d).hexdigest(), hashlib.sha256(d).hexdigest(),
               hashlib.sha3_256(d).hexdigest(), hashlib.blake2s(d).hexdigest(),
               hashlib.new("sha512_256", d).hexdigest(), hashlib.shake_128(d).hexdigest(16)]
out["hmac"] = hmac.new(b"key", b"The quick brown fox jumps over the lazy dog", "sha256").hexdigest()
out["crc"] = [zlib.crc32(d), zlib.adler32(d), zlib.ZLIB_RUNTIME_VERSION]
blob = os.urandom(4096) * 25 + bytes(range(256)) * 400
out["round"] = [zlib.decompress(zlib.compress(blob, 9)) == blob, bz2.decompress(bz2.compress(blob)) == blob,
                lzma.decompress(lzma.compress(blob, check=lzma.CHECK_SHA256)) == blob,
                lzma.decompress(lzma.compress(blob, format=lzma.FORMAT_ALONE)) == blob,
                len(zlib.compress(blob)) < len(blob)]
# TLS 1.3 over memory BIOs.
open("/tmp/c.pem", "w").write(CERT); open("/tmp/k.pem", "w").write(KEY)
sctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); sctx.load_cert_chain("/tmp/c.pem", "/tmp/k.pem")
cctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT); cctx.load_verify_locations(cadata=CERT)
cctx.minimum_version = ssl.TLSVersion.TLSv1_3
ci, co, si, so = ssl.MemoryBIO(), ssl.MemoryBIO(), ssl.MemoryBIO(), ssl.MemoryBIO()
c = cctx.wrap_bio(ci, co, server_hostname="localhost"); s = sctx.wrap_bio(si, so, server_side=True)
done = [False, False]
for _ in range(20):
    for i, obj in enumerate((c, s)):
        if not done[i]:
            try:
                obj.do_handshake(); done[i] = True
            except ssl.SSLWantReadError:
                pass
    si.write(co.read()); ci.write(so.read())
    if all(done): break
c.write(b"ping"); si.write(co.read()); msg = s.read(4)
s.write(b"pong:" + msg); ci.write(so.read())
out["tls"] = [ssl.OPENSSL_VERSION.split()[1], c.version(), c.cipher()[0], c.read(9).decode(), c.getpeercert()["subject"][0][0][1]]
out["rand"] = [len(ssl.RAND_bytes(16)), ssl.RAND_status()]
# sqlite3
db = sqlite3.connect("/tmp/t.db")
db.execute("create table t(k integer primary key, v text)")
with db: db.executemany("insert into t(v) values (?)", [("a",), ("b",), ("c",)])
try:
    with db:
        db.execute("insert into t(v) values ('d')"); raise RuntimeError
except RuntimeError: pass
db.execute("create virtual table f using fts5(body)"); db.execute("insert into f values ('hello wasix world')")
out["sqlite"] = [sqlite3.sqlite_version, db.execute("select count(*) from t").fetchone()[0],
                 db.execute("select body from f where f match 'wasix'").fetchone()[0],
                 db.execute("""select json_extract('{"a":[1,2]}', '$.a[1]'), sqrt(16)""").fetchone(),
                 sorted(r[0] for r in db.execute("pragma compile_options") if not r[0].startswith("COMPILER="))]
# threads
lock = threading.Lock(); n = [0]
def bump():
    for _ in range(1000):
        with lock: n[0] += 1
ts = [threading.Thread(target=bump) for _ in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
with ThreadPoolExecutor(4) as ex: sq = sum(ex.map(lambda x: x * x, range(100)))
out["threads"] = [n[0], sq]
# subprocess (posix_spawn)
r = subprocess.run(["echo", "hi"], capture_output=True, text=True)
p = subprocess.Popen(["cat"], stdin=subprocess.PIPE, stdout=subprocess.PIPE); o, _ = p.communicate(b"through cat")
cwd = subprocess.run(["pwd"], cwd="/tmp", capture_output=True, text=True).stdout.strip()
env = subprocess.run(["bash", "-c", "echo $HS_X"], env={"HS_X": "envok", "PATH": os.environ["PATH"]}, capture_output=True, text=True).stdout.strip()
rc = subprocess.run(["bash", "-c", "exit 3"]).returncode
child = subprocess.run([sys.executable, "-c", "import sys; print(sys.version_info[:2])"], capture_output=True, text=True).stdout.strip()
out["subprocess"] = [r.stdout, o.decode(), cwd, env, rc, child]
# select on a pipe
rfd, wfd = os.pipe(); os.write(wfd, b"x")
out["select"] = [select.select([rfd], [], [], 1)[0] == [rfd], select.select([], [wfd], [], 1)[1] == [wfd]]
try:
    import ctypes
    out["ctypes"] = "importable"
except ImportError as e:
    out["ctypes"] = repr(e)
print(json.dumps(out))
`;

const SQLITE_11 = ['ATOMIC_INTRINSICS=1', 'DEFAULT_AUTOVACUUM', 'DEFAULT_CACHE_SIZE=-2000', 'DEFAULT_FILE_FORMAT=4',
  'DEFAULT_JOURNAL_SIZE_LIMIT=-1', 'DEFAULT_MMAP_SIZE=0', 'DEFAULT_PAGE_SIZE=4096', 'DEFAULT_PCACHE_INITSZ=20',
  'DEFAULT_RECURSIVE_TRIGGERS', 'DEFAULT_SECTOR_SIZE=4096', 'DEFAULT_SYNCHRONOUS=2', 'DEFAULT_WAL_AUTOCHECKPOINT=1000',
  'DEFAULT_WAL_SYNCHRONOUS=2', 'DEFAULT_WORKER_THREADS=0', 'DIRECT_OVERFLOW_READ', 'DISABLE_LFS',
  'ENABLE_COLUMN_METADATA', 'ENABLE_DBSTAT_VTAB', 'ENABLE_FTS5', 'ENABLE_MATH_FUNCTIONS', 'ENABLE_RTREE',
  'MALLOC_SOFT_LIMIT=1024', 'MAX_ATTACHED=10', 'MAX_COLUMN=2000', 'MAX_COMPOUND_SELECT=500',
  'MAX_DEFAULT_PAGE_SIZE=8192', 'MAX_EXPR_DEPTH=1000', 'MAX_FUNCTION_ARG=1000', 'MAX_LENGTH=1000000000',
  'MAX_LIKE_PATTERN_LENGTH=50000', 'MAX_MMAP_SIZE=0', 'MAX_PAGE_COUNT=0xfffffffe', 'MAX_PAGE_SIZE=65536',
  'MAX_SQL_LENGTH=1000000000', 'MAX_TRIGGER_DEPTH=1000', 'MAX_VARIABLE_NUMBER=32766', 'MAX_VDBE_OP=250000000',
  'MAX_WORKER_THREADS=8', 'MUTEX_PTHREADS', 'OMIT_LOAD_EXTENSION', 'OMIT_WAL', 'SYSTEM_MALLOC', 'TEMP_STORE=1',
  'THREADSAFE=1'];

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/home/stdlib_check.py', `CERT = ${JSON.stringify(CERT)}\nKEY = ${JSON.stringify(KEY)}\n${SCRIPT}`);
  const r = await run(['python', '/home/stdlib_check.py'], { cwd: '/home' });
  assert.equal(r.status, 0, `stdlib_check.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout);
  console.log(`stdlib: ctypes -> ${o.ctypes}`);
  assert.deepEqual(o.hash, [
    '900150983cd24fb0d6963f7d28e17f72',
    'a9993e364706816aba3e25717850c26c9cd0d89d',
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
    '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982',
    '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23',
    '5881092dd818bf5cf8a3ddb793fbcba7',
  ]);
  assert.equal(o.hmac, 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.deepEqual(o.crc, [891568578, 38600999, '1.3.1']);
  assert.deepEqual(o.round, [true, true, true, true, true]);
  assert.deepEqual(o.tls, ['3.5.9', 'TLSv1.3', 'TLS_AES_256_GCM_SHA384', 'pong:ping', 'localhost']);
  assert.deepEqual(o.rand, [16, true]);
  assert.deepEqual(o.sqlite.slice(0, 4), ['3.53.4', 3, 'hello wasix world', [2, 4.0]]);
  assert.deepEqual(o.sqlite[4], SQLITE_11, 'sqlite compile options differ from 3.14.2-11');
  assert.deepEqual(o.threads, [8000, 328350]);
  assert.deepEqual(o.subprocess, ['hi\n', 'through cat', '/tmp', 'envok', 3, '(3, 14)']);
  assert.deepEqual(o.select, [true, true]);
}
