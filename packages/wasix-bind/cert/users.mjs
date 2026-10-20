const zone = (req) => {
  const q = req.tcp.slice(2);
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  if (req.tcp.length < 2 + ((req.tcp[0] << 8) | req.tcp[1])) return null;
  let i = 12;
  while (q[i]) i += q[i] + 1;
  const qend = i + 5;
  const a = new Uint8Array([
    q[0], q[1], 0x81, 0x80, ...u16(1), ...u16(1), 0, 0, 0, 0,
    ...q.slice(12, qend), 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 77,
  ]);
  return new Uint8Array([...u16(a.length), ...a]);
};

export default async function (ctx) {
  const { run, read, assert, addUser, uplink } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  await uplink({ peers: { '100.100.100.100:53': { tcp: zone.toString() } } });
  const setup = await run(['bash', '-c', [
    'mkdir -p /home/bob/out',
    `chown ${bob.uid}:${bob.gid} /home/bob/out`,
    'chmod 755 /home/bob /home/bob/out',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  for (const user of [null, 'alice', 'bob']) {
    const opts = user ? { cwd: `/home/${user}`, user } : { cwd: '/root' };
    const who = user ?? 'root';
    let r = await run(['dig', '+short', '@100.100.100.100', 'users.test'], opts);
    assert.equal(r.status, 0, `${who} dig: ${out(r)}`);
    assert.equal(r.stdout, '192.0.2.77\n', `${who} dig: ${out(r)}`);
    r = await run(['host', '-t', 'a', 'users.test', '100.100.100.100'], opts);
    assert.equal(r.status, 0, `${who} host: ${out(r)}`);
    assert.match(r.stdout, /^users\.test has address 192\.0\.2\.77$/m, `${who} host: ${out(r)}`);
  }

  // Only root writes /etc/resolv.conf.
  let r = await run(['bash', '-c', 'echo nameserver 100.100.100.100 > /etc/resolv.conf'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 1, `alice writing /etc/resolv.conf: ${out(r)}`);
  assert.equal(await read('etc/resolv.conf'), null);

  r = await run(['bash', '-c', 'dig +short @100.100.100.100 users.test > /home/bob/out/a.txt'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 1, `alice writing into bob's 0755 directory: ${out(r)}`);
  assert.match(r.stderr, /\/home\/bob\/out\/a\.txt: Permission denied/, out(r));
  assert.equal(await read('home/bob/out/a.txt'), null, "nothing written in bob's directory");

  r = await run(['bash', '-c', 'dig +short @100.100.100.100 users.test > /home/bob/out/b.txt && stat -c "%u:%g %a" /home/bob/out/b.txt'], { cwd: '/home/bob', user: 'bob' });
  assert.equal(r.status, 0, `bob writes his own: ${out(r)}`);
  assert.equal(r.stdout, `${bob.uid}:${bob.gid} 644\n`, out(r));
  assert.equal(await read('home/bob/out/b.txt'), '192.0.2.77\n');

  console.log(`users: dig and host answer the same for root, alice (${alice.uid}) and bob (${bob.uid}); alice can't write /etc/resolv.conf or into bob's directory; bob's own output is his`);
}
