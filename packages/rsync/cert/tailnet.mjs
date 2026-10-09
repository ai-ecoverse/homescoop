/**
 * rsync:// to a tailnet name (3.4.4-3, homescoop#139 shim): getaddrinfo asks
 * the kernel resolver and so the page's uplink (the harness's fake tailnet,
 * cert/meta.json "uplink": true), and the connection is dialled over it. The
 * fake peer refuses, so rsync reports a refused connection, after resolving
 * and dialling, not an unreachable host; an unknown name is not dialled.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  await ctx.uplink({
    names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
    peers: { '100.64.1.2:873': { error: 'ECONNREFUSED' } },
  });
  const rs = (url) => run(['bash', '-c', `timeout 20 rsync ${url} 2>&1; echo "rc=$?"`], { cwd: '/home' });

  const peer = await rs('rsync://peer.tail1234.ts.net/');
  assert.match(peer.stdout, /failed to connect to peer\.tail1234\.ts\.net \(100\.64\.1\.2\): Connection refused/, peer.stdout);
  assert.match(peer.stdout, /^rc=10$/m);
  const log = await ctx.uplinkLog();
  assert.ok(log.asked.some((a) => a.name === 'peer.tail1234.ts.net' && a.family === 4), JSON.stringify(log.asked));
  assert.deepEqual(log.dialled.at(-1), { host: '100.64.1.2', port: 873 });

  const before = (await ctx.uplinkLog()).dialled.length;
  const none = await rs('rsync://nobody.tail1234.ts.net/');
  assert.match(none.stdout, /^rc=10$/m, none.stdout);
  assert.doesNotMatch(none.stdout, /Connection refused/);
  assert.equal((await ctx.uplinkLog()).dialled.length, before, 'an unknown name was dialled');
}
