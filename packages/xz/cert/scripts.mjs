const plain = (s) =>
  s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/ \x08/g, '')
    .replace(/\r/g, '');

export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/xzs';
  await run(['mkdir', '-p', cwd], { cwd: '/home' });
  const sh = (script) => run(['bash', '--norc', '-c', script], { cwd });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc ${r.status} ${r.stdout}${r.stderr}`);
    return r;
  };
  await ok("printf 'alpha\\nbeta\\n' > a.txt && printf 'alpha\\ngamma\\n' > b.txt && cp a.txt c.txt && xz -k a.txt b.txt c.txt");
  assert.equal((await ok('xzgrep beta a.txt.xz')).stdout, 'beta\n');
  assert.equal((await ok('xzgrep -c a a.txt.xz')).stdout, '2\n');
  assert.equal((await ok('xzgrep -H gamma a.txt.xz b.txt.xz')).stdout, 'b.txt.xz:gamma\n');
  const miss = await sh('xzgrep delta a.txt.xz');
  assert.equal(miss.status, 1, `no match: ${miss.stderr}`);
  assert.equal((await ok('xzdiff a.txt.xz c.txt.xz')).stdout, '');
  const d = await sh('xzdiff a.txt.xz b.txt.xz');
  assert.equal(d.status, 1, `xzdiff of different files: ${d.stderr}`);
  assert.match(d.stdout, /^< beta$/m);
  assert.match(d.stdout, /^> gamma$/m);
  const less = await ok('xzless a.txt.xz');
  assert.equal(less.stdout, 'alpha\nbeta\n', `xzless out=${JSON.stringify(less.stdout)} err=${less.stderr}`);
  assert.doesNotMatch(less.stdout + less.stderr, /may be a binary file/);
  assert.equal((await ok('xzless a.txt.xz b.txt.xz')).stdout, 'alpha\nbeta\nalpha\ngamma\n');
  await ok(': > e.txt && xz -k e.txt');
  assert.equal((await ok('xzless e.txt.xz')).stdout, '', 'an empty .xz shows nothing, not its compressed bytes');
  const page = await pty(['xzless', '-F', '-X', 'b.txt.xz'], { cwd, cols: 40 });
  assert.equal(page.status, 0, `xzless on a pty: status=${page.status} out=${JSON.stringify(page.out)}`);
  assert.equal(plain(page.out).trimEnd(), 'alpha\ngamma', `xzless on a pty: ${JSON.stringify(page.out)}`);
  assert.doesNotMatch(page.out, /may be a binary file/);
  console.log('scripts: xzgrep (match, -c, -H, no match rc 1), xzdiff (same rc 0, different rc 1 with the diff) and xzless (two files, an empty one, -F -X on a pty) run as slicc commands (homescoop#537, homescoop#1487)');
}
