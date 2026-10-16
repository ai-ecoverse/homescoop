export default async function ({ run, write, read, assert }) {
  const sh = (s) => run(['bash', '-c', s], { cwd: '/tmp' });
  await write('/tmp/p/d/s p/ü.txt', 'hi');
  const a = await sh('ls "/tmp/p/d/s p"; stat -c "%F %s" "/tmp/p/d/s p/ü.txt"; cat "/tmp/p/d/s p/ü.txt"');
  console.log('WRITE', JSON.stringify(a));
  assert.equal(a.stdout, 'ü.txt\nregular file 2\nhi');
  const b = await sh('mkdir -p /tmp/w && cd /tmp/w && printf x > "café.txt" && touch "名.txt" && mkdir "ü" && mv café.txt "😀 é.txt" && ls && stat -c "%F %s %n" *');
  console.log('BASH', JSON.stringify(b));
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout, 'ü\n名.txt\n😀 é.txt\ndirectory 4096 ü\nregular empty file 0 名.txt\nregular file 1 😀 é.txt\n');
  const z = await sh('mkdir -p /tmp/z/out && cd /tmp/z && printf abc > "café.txt" && printf d > "日本語.txt" && zip -q a.zip "café.txt" "日本語.txt" && cd out && unzip -q ../a.zip && ls && cat "café.txt" "日本語.txt"');
  console.log('ZIP', JSON.stringify(z));
  assert.equal(z.status, 0, z.stderr);
  assert.equal(z.stdout, 'café.txt\n日本語.txt\nabcd');
}
