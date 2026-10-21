/**
 * File locks (homescoop#706): two uv processes on one environment or one
 * cache exclude each other. Up to 0.13.1-1 0003-wasi-the-filesystem-as-unix
 * granted every lock without one, so a second `uv pip install` wrote the same
 * site-packages and `uv cache clean` removed the cache under a running
 * install. Since 0.13.1-2 uv's LockedFile takes whole-file record locks
 * through the kernel's slicc.fcntl_lock (slicc-kernel >= 1.100.0), with
 * flock's semantics between holders in one process.
 *
 * A: `uv -vv pip install --no-binary six six` (an sdist build, seconds) holds
 * the venv's exclusive lock and the cache's shared lock. Once A's trace says
 * it has them, B starts on the same venv / cache, and must wait for A.
 */
import { createHash } from 'node:crypto';
import { detached } from './lib/detached.mjs';

const FILES = 'https://files.pythonhosted.org/packages';
const DISTS = [
  ['idna-3.20-py3-none-any.whl', 'ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c',
    `${FILES}/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl`],
  ['setuptools-84.0.0-py3-none-any.whl', '51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670',
    `${FILES}/95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl`],
  ['six-1.17.0.tar.gz', 'ff70335d468e7eb6ec65b95b99d3a2836546063f63acc5171de367e834932a81',
    `${FILES}/94/e7/b2c673351809dca68a0e064b6af791aa332cf192da575fd474ed7d6f16a2/six-1.17.0.tar.gz`],
];

// Start A in the background, wait (at most 60 s) until its trace says it
// holds the lock named by $1, then run B ($2) and wait for A.
const RACE = String.raw`
want=$1; b=$2; a=$3
: > a.log
$a > a.log 2>&1 &
pid=$!
for i in $(seq 300); do
  [[ "$(< a.log)" =~ $want ]] && break
  kill -0 $pid 2>/dev/null || break
  sleep 0.2
done
[[ "$(< a.log)" =~ $want ]] && echo "a-held" || echo "a-never-held"
kill -0 $pid 2>/dev/null && echo "a-running" || echo "a-done-early"
$b > b.log 2>&1; echo "b=$?"
wait $pid; echo "a=$?"
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvl.toml' };
  const ok = async (script, cwd = '/home') => {
    const r = await run(['bash', '-c', script], { cwd, env });
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };
  const slow = detached(ctx, { env });
  const okSlow = async (script, cwd) => {
    const r = await slow(script, cwd);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };

  await ok('mkdir -p /home/ldists /home/l');
  for (const [name, sha, url] of DISTS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/ldists/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/ldists');
  }
  await write('/home/uvl.toml', 'no-index = true\nfind-links = ["/home/ldists"]\n');
  await write('/home/race.sh', RACE);
  await ok('uv venv -q', '/home/l');

  // Two installs into one venv: B waits for A's exclusive lock on .venv/.lock.
  const venv = await okSlow(
    "bash /home/race.sh 'Acquired exclusive lock for `[^`]*\\.venv`' 'uv -v pip install idna' 'uv -vv pip install --no-binary six six'; cat b.log",
    '/home/l',
  );
  assert.match(venv.stdout, /^a-held\na-running\nb=0\na=0\n/, `A held the venv lock and was still running when B started; both succeeded: ${venv.stdout}`);
  assert.match(venv.stdout, /Waiting to acquire exclusive lock for `[^`]*\.venv`/, `B waited for A's lock on the venv (0.13.1-1 doesn't: no lock): ${venv.stdout}`);
  const both = await ok("uv pip list && .venv/bin/python -c 'import six, idna; print(six.__version__, idna.__version__)'", '/home/l');
  assert.match(both.stdout, /^idna\s+3\.20$/m);
  assert.match(both.stdout, /^six\s+1\.17\.0$/m);
  assert.match(both.stdout, /^1\.17\.0 3\.20$/m, `both installs are in the venv: ${both.stdout}`);

  // uv cache clean while an install uses the cache: it waits for the
  // install's shared lock on the cache root, and the install completes.
  const cache = await okSlow(
    "bash /home/race.sh 'Acquired shared lock for `[^`]*uv`' 'uv cache clean' 'uv -vv pip install --reinstall --refresh-package six --no-binary six six'; cat b.log",
    '/home/l',
  );
  assert.match(cache.stdout, /^a-held\na-running\nb=0\na=0\n/, `A held the cache lock and was still running when uv cache clean started; both succeeded: ${cache.stdout}`);
  assert.match(cache.stdout, /Cache is currently in-use, waiting for other uv processes to finish/, `uv cache clean waited for the running install: ${cache.stdout}`);
  const after = await ok(".venv/bin/python -c 'import six; print(six.__version__)'", '/home/l');
  assert.equal(after.stdout.trim(), '1.17.0');
  console.log('locks: a second uv pip install waits for the venv lock; uv cache clean waits for a running install; the venv is consistent');
}
