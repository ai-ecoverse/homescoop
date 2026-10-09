/**
 * curl to tailnet names (homescoop#139): getaddrinfo in the slicc socket
 * shim asks the kernel resolver, which asks the page's uplink (here the
 * harness's fake tailnet, cert/meta.json "uplink": true). Direct TCP with
 * --noproxy, as seven's tailnet users run it.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  await ctx.uplink({
    names: {
      'peer.tail1234.ts.net': ['100.64.1.2'],
      'loop.tail1234.ts.net': ['127.0.0.1'],
      'host.tail1234.ts.net': ['10.0.2.2'],
    },
    peers: {
      '100.64.1.2:8080': { http: { body: 'hello from the tailnet\n' } },
      '100.64.1.2:9090': { error: 'ECONNREFUSED' },
    },
  });
  const curl = (...args) => run(['curl', '-sS', '--noproxy', '*', ...args]);

  // A MagicDNS name: resolved through the uplink, then dialled over it.
  const ok = await curl('http://peer.tail1234.ts.net:8080/hello?x=1');
  assert.equal(ok.status, 0, `rc=${ok.status} stderr=${ok.stderr}`);
  assert.equal(ok.stdout, 'hello from the tailnet\n');
  const log = await ctx.uplinkLog();
  assert.ok(log.asked.some((a) => a.name === 'peer.tail1234.ts.net' && a.family === 4), JSON.stringify(log.asked));
  assert.deepEqual(log.dialled.at(-1), { host: '100.64.1.2', port: 8080 });
  const head = log.requests.at(-1).head;
  assert.match(head, /^GET \/hello\?x=1 HTTP\/1\.1\r\n/);
  assert.match(head, /\r\nHost: peer\.tail1234\.ts\.net:8080(\r\n|$)/);

  // Answers pointing into the kernel are dropped: not found, nothing dialled.
  for (const name of ['loop.tail1234.ts.net', 'host.tail1234.ts.net', 'nobody.tail1234.ts.net']) {
    const before = (await ctx.uplinkLog()).dialled.length;
    const r = await curl(`http://${name}:8080/`);
    assert.equal(r.status, 6, `${name}: rc=${r.status} stderr=${r.stderr}`);
    assert.match(r.stderr, /Could not resolve/);
    assert.equal((await ctx.uplinkLog()).dialled.length, before, `${name} was dialled`);
  }

  // A resolved peer that refuses: connect error, not a resolve error.
  const refused = await curl('http://peer.tail1234.ts.net:9090/');
  assert.equal(refused.status, 7, `refused rc=${refused.status} stderr=${refused.stderr}`);

  // This machine's own name is loopback, answered by the shim without
  // asking the uplink (#149): connection refused on :1, not a resolve error.
  const self = (await run(['hostname'])).stdout.trim();
  assert.ok(self, 'hostname printed nothing');
  const own = await curl(`http://${self}:1/`);
  assert.equal(own.status, 7, `${self}:1 rc=${own.status} stderr=${own.stderr}`);
  assert.ok(!(await ctx.uplinkLog()).asked.some((a) => a.name.toLowerCase() === self.toLowerCase()),
    `the uplink was asked for ${self}`);

  // localhost and the realm proxy path are unchanged.
  const local = await curl('http://localhost:1/');
  assert.equal(local.status, 7, `localhost:1 rc=${local.status} stderr=${local.stderr}`);
}
