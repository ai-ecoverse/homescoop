export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const nums = await sh('stat -c "%n %F %t:%T" /dev/null /dev/zero /dev/full /dev/tty');
  assert.deepEqual(nums.split('\n'), [
    '/dev/null character special file 1:3',
    '/dev/zero character special file 1:5',
    '/dev/full character special file 1:7',
    '/dev/tty character special file 5:0',
  ], `stat %t:%T: ${nums}`);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await sh('ls -l /dev/null | cut -d" " -f5-6'));
  assert.deepEqual(runs, ['1, 3', '1, 3', '1, 3'], `ls -l /dev/null major, minor: ${runs.join(' | ')}`);
  const plain = await sh('touch /tmp/rf && stat -c "%t:%T" /tmp/rf');
  assert.equal(plain, '0:0', `a regular file has no device number: ${plain}`);
  console.log(`rdev: ${nums.split('\n').map((l) => l.split(' ').pop()).join(' ')}; ls -l /dev/null "${runs[0]}" on 3 runs; regular file 0:0`);
}
