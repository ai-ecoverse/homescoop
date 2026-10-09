/**
 * git over HTTP to a tailnet name (homescoop#139): libcurl's getaddrinfo
 * is the slicc socket shim's, which asks the kernel resolver and so the
 * page's uplink (the harness's fake tailnet, cert/meta.json "uplink": true).
 * The peer answers a smart-HTTP (v0) ref advertisement; no_proxy=* sends
 * git straight to it instead of through the realm proxy.
 */
const pkt = (s) => (s.length + 4).toString(16).padStart(4, '0') + s;
const SHA = '0123456789abcdef0123456789abcdef01234567';

export default async function (ctx) {
  const { run, assert } = ctx;
  await ctx.uplink({
    names: {
      'peer.tail1234.ts.net': ['100.64.1.2'],
      'loop.tail1234.ts.net': ['127.0.0.1'],
    },
    peers: {
      '100.64.1.2:8080': {
        http: {
          headers: [['Content-Type', 'application/x-git-upload-pack-advertisement'], ['Cache-Control', 'no-cache']],
          body:
            pkt('# service=git-upload-pack\n') + '0000' +
            pkt(`${SHA} HEAD\0symref=HEAD:refs/heads/main agent=git/fake\n`) +
            pkt(`${SHA} refs/heads/main\n`) + '0000',
        },
      },
    },
  });
  const env = { no_proxy: '*', NO_PROXY: '*', GIT_TERMINAL_PROMPT: '0' };
  const git = (...args) => run(['git', ...args], { cwd: '/home', env });

  // A local-only workflow never asks the uplink. Without a configured
  // identity (the clone's reflog, here) git builds its default ident from
  // the hostname and resolves it; the shim answers that locally instead of
  // leaking it to MagicDNS (and stalling when that is slow).
  const local = await run(
    ['bash', '-c',
      'git init -q -b main loc && cd loc && echo a > f && git add f && ' +
      'git -c user.name=T -c user.email=t@example.test commit -qm one && cd .. && ' +
      'git clone -q loc loc2 && git -C loc2 log --format=%s && git -C loc2 reflog -1 --format=%gs'],
    { cwd: '/home', env },
  );
  assert.equal(local.status, 0, `local workflow rc=${local.status} stderr=${local.stderr}`);
  assert.match(local.stdout, /^one\nclone: from /);
  assert.deepEqual((await ctx.uplinkLog()).asked, [], 'a local git workflow asked the uplink');

  const ls = await git('ls-remote', 'http://peer.tail1234.ts.net:8080/repo.git');
  assert.equal(ls.status, 0, `ls-remote rc=${ls.status} stderr=${ls.stderr}`);
  assert.equal(ls.stdout, `${SHA}\tHEAD\n${SHA}\trefs/heads/main\n`);
  const log = await ctx.uplinkLog();
  assert.ok(log.asked.some((a) => a.name === 'peer.tail1234.ts.net' && a.family === 4), JSON.stringify(log.asked));
  assert.deepEqual(log.dialled.at(-1), { host: '100.64.1.2', port: 8080 });
  const head = log.requests.at(-1).head;
  assert.match(head, /^GET \/repo\.git\/info\/refs\?service=git-upload-pack HTTP\/1\.1\r\n/);
  assert.match(head, /\r\nHost: peer\.tail1234\.ts\.net:8080(\r\n|$)/);

  // An answer pointing into the kernel is dropped: curl's resolve error.
  const before = (await ctx.uplinkLog()).dialled.length;
  const loop = await git('ls-remote', 'http://loop.tail1234.ts.net:8080/repo.git');
  assert.equal(loop.status, 128, `loop rc=${loop.status} stderr=${loop.stderr}`);
  assert.match(loop.stderr, /Could not resolve( host)?: loop\.tail1234\.ts\.net/);
  assert.equal((await ctx.uplinkLog()).dialled.length, before, 'loop name was dialled');
}
