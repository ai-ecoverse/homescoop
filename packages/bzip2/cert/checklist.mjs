export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r;
  };
  await sh('rm -rf /tmp/bz && mkdir /tmp/bz && cd /tmp/bz && head -c 250000 /dev/urandom > data && printf "homescoop-bzip2\\n" > small');

  const small = await sh('cd /tmp/bz && bzip2 -k small && od -An -tx1 -N3 small.bz2 && bunzip2 -c small.bz2 && bzcat small.bz2');
  assert.equal(small.stdout, ' 42 5a 68\nhomescoop-bzip2\nhomescoop-bzip2\n', 'bzip2 -k / bunzip2 -c / bzcat round trip');

  const rec = await run(['bash', '-c', 'cd /tmp/bz && bzip2 -1 -k data && bzip2recover data.bz2'], { cwd: '/tmp' });
  assert.equal(rec.status, 0, `bzip2recover rc=${rec.status} stderr=${rec.stderr}`);
  assert.match(rec.stderr, /block 1 runs from \d+ to \d+\n/, `block offsets: ${rec.stderr}`);
  assert.match(rec.stderr, /block 3 runs from \d+ to \d+\n/, `block offsets: ${rec.stderr}`);
  assert.doesNotMatch(rec.stderr, /I\/O error|Invalid argument/, rec.stderr);
  const files = await sh('cd /tmp/bz && ls rec*data.bz2');
  assert.deepEqual(files.stdout.trim().split('\n'), ['rec00001data.bz2', 'rec00002data.bz2', 'rec00003data.bz2']);
  await sh('cd /tmp/bz && for f in rec*data.bz2; do bzip2 -t "$f"; done');
  const sums = await sh('cd /tmp/bz && cat rec*data.bz2 | bunzip2 | sha256sum && sha256sum < data');
  const [got, want] = sums.stdout.trim().split('\n');
  assert.equal(got, want, 'the recovered blocks decompress to the original');
  console.log('bzip2: round trip; bzip2recover splits a 3-block file into rec00001..rec00003, each tests clean and together they give the original');
}
