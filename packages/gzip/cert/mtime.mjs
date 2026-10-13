export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['bash', '-c', 'rm -rf /tmp/gzm && mkdir /tmp/gzm && cd /tmp/gzm && printf data > a && head -c 300000 /dev/urandom > big && touch -d @1577930645 a big && gzip -k a && gzip -k big && cp a.gz r.gz && touch -d @1609455600 r.gz && gunzip r.gz && stat -c "%Y %n" a.gz big.gz r'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), ['1577930645 a.gz', '1577930645 big.gz', '1609455600 r'], `gzip -k gives the output the input's mtime; gunzip the .gz's: ${r.stdout}`);
  console.log('mtime: gzip -k keeps the input mtime (small and 300 kB), gunzip takes the .gz mtime (slicc-kernel 1.73.3, #441)');
}
