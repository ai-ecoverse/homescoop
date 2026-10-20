export default async function (ctx) {
  const { run, assert } = ctx;
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
  assert.equal((await ok('xzless a.txt.xz | cat')).stdout, 'alpha\nbeta\n');
  console.log('scripts: xzgrep (match, -c, -H, no match rc 1), xzdiff (same rc 0, different rc 1 with the diff) and xzless (through a pipe) run as slicc commands (homescoop#537)');
}
