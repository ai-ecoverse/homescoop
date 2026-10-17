const zone = (req) => {
  const q = req.tcp ? req.tcp.slice(2) : req.body;
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  let i = 12;
  while (q[i]) i += q[i] + 1;
  const qend = i + 5;
  const a = new Uint8Array([
    q[0], q[1], 0x81, 0x80, ...u16(1), ...u16(1), 0, 0, 0, 0,
    ...q.slice(12, qend), 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 77,
  ]);
  if (req.tcp) return new Uint8Array([...u16(a.length), ...a]);
  return { headers: [['content-type', 'application/dns-message']], body: a };
};

export default async function (ctx) {
  const { run, read, assert, addUser, serve, uplink } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  await serve(zone);
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
    let r = await run(['dig', '+short', 'users.test'], opts);
    assert.equal(r.status, 0, `${user ?? 'root'} over DoH: ${out(r)}`);
    assert.equal(r.stdout, '192.0.2.77\n', `${user ?? 'root'} over DoH: ${out(r)}`);
    r = await run(['dig', '+short', '@100.100.100.100', 'users.test'], opts);
    assert.equal(r.status, 0, `${user ?? 'root'} over TCP: ${out(r)}`);
    assert.equal(r.stdout, '192.0.2.77\n', `${user ?? 'root'} over TCP: ${out(r)}`);
  }

  let r = await run(['bash', '-c', 'dig +short users.test > /home/bob/out/a.txt'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 1, `alice writing dig's answer into bob's 0755 directory: ${out(r)}`);
  assert.match(r.stderr, /\/home\/bob\/out\/a\.txt: Permission denied/, out(r));
  assert.equal(await read('home/bob/out/a.txt'), null, "nothing written in bob's directory");

  r = await run(['bash', '-c', 'dig +short users.test > /home/bob/out/b.txt && stat -c "%u:%g %a" /home/bob/out/b.txt'], { cwd: '/home/bob', user: 'bob' });
  assert.equal(r.status, 0, `bob writes his own: ${out(r)}`);
  assert.equal(r.stdout, `${bob.uid}:${bob.gid} 644\n`, out(r));
  assert.equal(await read('home/bob/out/b.txt'), '192.0.2.77\n');

  console.log(`users: dig answers the same as root, alice (${alice.uid}) and bob (${bob.uid}) over DoH and TCP; alice can't write its output into bob's directory; bob's own output is his`);
}
