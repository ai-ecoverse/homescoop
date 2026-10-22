const PEER = 'http://peer.tail1234.ts.net:8080';

export default async function envhome(ctx) {
  const { run, assert } = ctx;
  await ctx.addUser({ name: 'alice' });
  await ctx.addUser({ name: 'bob' });
  await ctx.uplink({
    names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
    peers: { '100.64.1.2:8080': { http: { body: 'peer\n' } } },
  });
  const seed = await run(['bash', '-c', [
    'mkdir -p /home/web_user && chmod 755 /home/web_user',
    `printf 'header = "X-Rc: web_user"\\n' > /home/web_user/.curlrc`,
    "printf 'machine peer.tail1234.ts.net login w password w\\n' > /home/web_user/.netrc",
    'chmod 644 /home/web_user/.curlrc /home/web_user/.netrc',
  ].join('\n')]);
  assert.equal(seed.status, 0, `seed /home/web_user: ${seed.stdout}${seed.stderr}`);
  const mine = await run(['bash', '-c', [
    `printf 'header = "X-Rc: alice"\\n' > ~/.curlrc`,
    "printf 'machine peer.tail1234.ts.net login u password p\\n' > ~/.netrc",
    'chmod 600 ~/.curlrc ~/.netrc',
  ].join('\n')], { cwd: '/home/alice', user: 'alice' });
  assert.equal(mine.status, 0, `alice's dotfiles: ${mine.stdout}${mine.stderr}`);

  const head = async (who, argv) => {
    const before = (await ctx.uplinkLog()).requests.length;
    const r = await run(argv, { cwd: `/home/${who}`, user: who });
    const log = (await ctx.uplinkLog()).requests;
    return { r, head: log.length > before ? log.at(-1).head : '' };
  };
  const curl = ['/usr/bin/curl', '-sS', '--noproxy', '*'];

  const rc = await head('alice', ['env', '-u', 'HOME', ...curl, `${PEER}/rc`]);
  assert.equal(rc.r.status, 0, `env -u HOME curl: ${rc.r.stdout}${rc.r.stderr}`);
  assert.match(rc.head, /\r\nX-Rc: alice(\r\n|$)/, `env -u HOME curl reads alice's ~/.curlrc through the passwd home: ${JSON.stringify(rc.head)}`);
  assert.doesNotMatch(rc.head, /web_user/, `env -u HOME curl read /home/web_user/.curlrc, Emscripten's HOME placeholder (homescoop#1625): ${JSON.stringify(rc.head)}`);

  const netrc = await head('alice', ['env', '-i', ...curl, '-n', `${PEER}/netrc`]);
  assert.equal(netrc.r.status, 0, `env -i curl -n: ${netrc.r.stdout}${netrc.r.stderr}`);
  assert.match(netrc.head, /\r\nAuthorization: Basic dTpw(\r\n|$)/, `env -i curl -n reads alice's ~/.netrc (u:p), not /home/web_user's (w:w): ${JSON.stringify(netrc.head)}`);

  const vars = ['HOME', 'USER', 'LOGNAME', 'PATH', 'PWD', 'LANG'];
  const env = await head('alice', ['env', '-i', ...curl, ...vars.flatMap((v) => ['--variable', `%${v}=unset`]),
    '--expand-header', `X-Env: ${vars.map((v) => `${v}={{${v}}}`).join(' ')}`, `${PEER}/env`]);
  assert.equal(env.r.status, 0, `env -i curl --variable: ${env.r.stdout}${env.r.stderr}`);
  const want = `X-Env: ${vars.map((v) => `${v}=unset`).join(' ')}`;
  assert.match(env.head, new RegExp(`\\r\\n${want}(\\r\\n|$)`), `env -i curl sees none of ${vars.join(', ')} (no web_user, PATH=/, PWD=/ or LANG placeholders, homescoop#1625): ${JSON.stringify(env.head)}`);

  const bob = await head('bob', ['env', '-u', 'HOME', ...curl, '-n', `${PEER}/bob`]);
  assert.equal(bob.r.status, 26, `bob's env -u HOME curl -n has no ~/.netrc: rc 26, got ${bob.r.status} ${bob.r.stdout}${bob.r.stderr}`);
  assert.doesNotMatch(bob.head, /Authorization/, `bob's curl -n sent someone else's credentials: ${JSON.stringify(bob.head)}`);

  console.log(`envhome: env -u HOME curl sends X-Rc: alice; env -i curl -n sends Basic dTpw; env -i curl sees ${vars.join(', ')} unset; bob's env -u HOME curl -n rc ${bob.r.status}, no Authorization`);
}
