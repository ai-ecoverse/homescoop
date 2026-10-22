const HOSTS = [
  '# 100.64.1.2 commented.test',
  '::1 v6only.test',
  '100.64.1.2 Alias.Review.TEST alias.test',
  '100.64.1.2 last.test',
].join('\n');

export default async function hosts(ctx) {
  const { run, assert } = ctx;
  await ctx.addUser({ name: 'alice' });
  await ctx.uplink({
    names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
    peers: { '100.64.1.2:8080': { http: { body: 'hello hosts\n' } } },
  });
  const add = await run(['bash', '-c', `printf '\\n%s' "$1" >> /etc/hosts`, 'hosts', HOSTS]);
  assert.equal(add.status, 0, `root appends to /etc/hosts: ${add.stdout}${add.stderr}`);
  const curl = (url, opts) => run(['curl', '-sS', '--noproxy', '*', url], opts);

  for (const name of ['alias.review.test.', 'ALIAS.test', 'last.test']) {
    const before = (await ctx.uplinkLog()).dialled.length;
    const r = await curl(`http://${name}:8080/`);
    assert.equal(r.status, 0, `${name}: rc=${r.status} ${r.stderr}`);
    assert.equal(r.stdout, 'hello hosts\n', name);
    const log = await ctx.uplinkLog();
    assert.deepEqual(log.dialled.slice(before), [{ host: '100.64.1.2', port: 8080 }], `${name} dials the /etc/hosts address`);
  }
  const asked = (await ctx.uplinkLog()).asked.map((a) => a.name.toLowerCase());
  assert.ok(!asked.some((n) => /alias|last\.test/.test(n)), `the uplink was asked for an /etc/hosts name (homescoop#580): ${JSON.stringify(asked)}`);

  for (const name of ['commented.test', 'v6only.test']) {
    const before = (await ctx.uplinkLog()).dialled.length;
    const r = await curl(`http://${name}:8080/`);
    assert.equal(r.status, 6, `${name}: rc=${r.status} ${r.stderr}`);
    assert.match(r.stderr, /Could not resolve/, name);
    assert.equal((await ctx.uplinkLog()).dialled.length, before, `${name} was dialled`);
  }

  const evil = await run(['bash', '-c', "printf '100.64.9.9 evil.test\\n' >> /etc/hosts"], { cwd: '/home/alice', user: 'alice' });
  assert.notEqual(evil.status, 0, `alice appended to /etc/hosts: ${evil.stdout}${evil.stderr}`);
  const after = await run(['cat', '/etc/hosts']);
  assert.doesNotMatch(after.stdout, /evil\.test/, `/etc/hosts has alice's line: ${after.stdout}`);

  console.log('hosts: alias.review.test., ALIAS.test and last.test (no trailing newline) reach 100.64.1.2:8080 without asking the uplink; commented and ::1-only names rc 6, nothing dialled; alice cannot append to /etc/hosts');
}
