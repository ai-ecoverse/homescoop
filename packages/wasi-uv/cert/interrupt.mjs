/**
 * Ending a running uv (0.13.1-4), as root under users enforce, from the same
 * offline find-links as locks.mjs (an sdist build of six takes seconds):
 * - homescoop#911: ^C at an interactive bash ends a foreground
 *   `uv -vv pip install --no-binary six six` (SIGINT's default action, $?
 *   130), bash prints the next prompt, and a later install into the venv
 *   doesn't wait for a lock. On slicc-kernel 1.110.7 uv didn't end; on
 *   1.134.3 it does, with 0.13.1-3 too (a kernel fix, no uv change).
 * - homescoop#910: `kill -9` of a uv that holds the venv's exclusive lock
 *   reaps it, the kernel drops its locks, and the next `uv pip install`
 *   into that venv goes ahead (slicc-kernel >= 1.104.1, slicc-kernel#755;
 *   engines.slicc-kernel says so since 0.13.1-4).
 */
import { createHash } from 'node:crypto';

const FILES = 'https://files.pythonhosted.org/packages';
const DISTS = [
  ['idna-3.20-py3-none-any.whl', 'ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c',
    `${FILES}/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl`],
  ['setuptools-84.0.0-py3-none-any.whl', '51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670',
    `${FILES}/95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl`],
  ['six-1.17.0.tar.gz', 'ff70335d468e7eb6ec65b95b99d3a2836546063f63acc5171de367e834932a81',
    `${FILES}/94/e7/b2c673351809dca68a0e064b6af791aa332cf192da575fd474ed7d6f16a2/six-1.17.0.tar.gz`],
];

export default async function (ctx) {
  const { run, write, pty, assert } = ctx;
  const env = { UV_CONFIG_FILE: '/home/uvi.toml' };
  const ok = async (script, cwd = '/home') => {
    const r = await run(['bash', '-c', script], { cwd, env });
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };
  await ok('mkdir -p /home/idists /home/i /home/k');
  for (const [name, sha, url] of DISTS) {
    const res = await fetch(url);
    assert.ok(res.ok, `fetch ${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
    await write(`/home/idists/${name}.b64`, bytes.toString('base64'));
    await ok(`base64 -d ${name}.b64 > ${name} && rm ${name}.b64`, '/home/idists');
  }
  await write('/home/uvi.toml', 'no-index = true\nfind-links = ["/home/idists"]\n');
  await ok('uv venv -q', '/home/i');
  await ok('uv venv -q', '/home/k');

  // #911: ^C to a foreground uv at a terminal.
  const t = await pty(['bash', '--norc', '-i'], {
    env,
    steps: [
      { expect: '[$#] ' },
      { write: 'cd /home/i && uv -vv pip install --no-binary six six 2>a.log\r' },
      { sleepMs: 4000, write: '\x03' },
      { expect: '\\^C', timeoutMs: 8000 },
      // A foreground job that SIGINT ended: bash's next prompt, and $? 130.
      { expect: '[$#] ', timeoutMs: 30000 },
      { write: 'echo "A=$?"\r' },
      { expect: 'A=[0-9]+', timeoutMs: 8000 },
      { write: 'exit 0\r' },
    ],
    timeoutMs: 60000,
  });
  assert.ok(!t.failedStep, `#911 ^C ends the running uv and bash prints its next prompt: ${t.failedStep ? `no ${JSON.stringify(t.failedStep.expect)}` : ''} ${JSON.stringify(t.out.slice(-400))}`);
  const a = /A=(\d+)/.exec(t.out)?.[1];
  assert.equal(a, '130', `#911 SIGINT ended the uv (128 + 2): A=${a}`);
  const after = await run(['bash', '-c', 'timeout 60 uv -v pip install idna; echo "rc=$?"'], { cwd: '/home/i', env });
  assert.match(after.stdout, /rc=0/, `#911 a later install into the venv doesn't wait for the interrupted uv's lock: ${after.stdout} ${after.stderr.slice(-600)}`);

  // #910: kill -9 of a uv that holds the venv's exclusive lock.
  const k = await run(['bash', '-c', String.raw`uv -vv pip install --no-binary six six > a.log 2>&1 & a=$!
for i in $(seq 300); do [[ "$(< a.log)" =~ "Acquired exclusive lock for" ]] && break; sleep 0.2; done
[[ "$(< a.log)" =~ "Acquired exclusive lock for" ]] && echo held
kill -9 $a; wait $a; echo "a=$?"
timeout 60 uv -v pip install idna > b.log 2>&1; echo "b=$?"`], { cwd: '/home/k', env });
  assert.match(k.stdout, /^held$/m, `#910 the first uv held the venv lock: ${k.stdout}`);
  assert.match(k.stdout, /^a=137$/m, `#910 kill -9 ends it (137): ${k.stdout}`);
  assert.match(k.stdout, /^b=0$/m, `#910 the next install goes ahead once the holder is killed: ${k.stdout}`);
  const list = await ok('uv pip list', '/home/k');
  assert.match(list.stdout, /^idna\s+3\.20$/m);
  console.log('interrupt: ^C ends a running uv at a terminal; kill -9 of a lock holder lets the next uv go ahead');
}
