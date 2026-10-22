const DECOY_CA = `-----BEGIN CERTIFICATE-----
MIIBejCCASCgAwIBAgIUVTMLtKUXhLNhIhmQiIQ8WMhSLNwwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXaG9tZXNjb29wIGNlcnQgZGVjb3kgQ0EwIBcNMjYxMDA5MTcw
OTM3WhgPMjEyNjA5MTUxNzA5MzdaMCIxIDAeBgNVBAMMF2hvbWVzY29vcCBjZXJ0
IGRlY295IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/TMSJELEOITBRPuB
cmBf4meqXUgzoCELxJOs3hlV1QJHijgmPmrut4eak18G7RdYdY4mFKLGkjVVUrjy
R5LWaqMyMDAwHQYDVR0OBBYEFP0MmyVlQ8xDflSyX1HrBR56yoZCMA8GA1UdEwEB
/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAPgov50uSXyN4V+xve6j+J4Vj0Jm
2kTV6HVbVm4c1XnCAiA7+Rd3tWEZR14eORFRylER2Q7RXS2nywUx+ePgmISgrg==
-----END CERTIFICATE-----
`;

async function responder(req) {
  const u = new URL(req.url);
  const m = u.pathname.match(/^\/repo\.git\/(.+)$/);
  const b64 = m && req.method === 'GET' ? await window.opfs.readBase64(`srv/repo.git/${m[1]}`) : null;
  if (b64 === null) return { status: 404, statusText: 'Not Found', headers: [['content-type', 'text/plain']], body: 'nope\n' };
  const raw = atob(b64);
  const body = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) body[i] = raw.charCodeAt(i);
  return { headers: [['content-type', 'application/octet-stream']], body };
}

export default async function gitHttps(ctx) {
  const { run, assert, addUser, serve } = ctx;
  const sh = (cmd, o = {}) => run(['bash', '-c', cmd], { cwd: '/tmp', ...o });
  const made = await sh(
    [
      'mkdir -p /srv && cd /root && git init -q -b main src && cd src && git config user.email r@x && git config user.name R',
      'printf "over https\\n" > f && git add f && git commit -qm one && printf "two\\n" >> f && git commit -qam two',
      'git clone -q --bare /root/src /srv/repo.git && git -C /srv/repo.git update-server-info',
      'git rev-parse HEAD',
    ].join(' && '),
  );
  assert.equal(made.status, 0, `${made.stdout}${made.stderr}`);
  const head = made.stdout.trim();
  await serve(responder);
  await addUser({ name: 'erin' });
  const env = { GIT_TERMINAL_PROMPT: '0' };
  const ls = await sh('git ls-remote https://cert.test/repo.git', { user: 'erin', env });
  assert.equal(ls.status, 0, `git ls-remote over https: ${ls.stdout}${ls.stderr}`);
  assert.match(ls.stdout, new RegExp(`^${head}\\trefs/heads/main$`, 'm'), ls.stdout);
  const clone = await sh('cd ~ && git clone -q https://cert.test/repo.git c && cat c/f && git -C c rev-parse HEAD && git -C c fsck --strict --no-progress 2>&1 | wc -l && stat -c %U c/f', { user: 'erin', env });
  assert.equal(clone.status, 0, `git clone over https as erin: ${clone.stdout}${clone.stderr}`);
  assert.equal(clone.stdout, `over https\ntwo\n${head}\n0\nerin\n`, JSON.stringify(clone.stdout));
  const missing = await sh('git ls-remote https://cert.test/missing.git; echo rc=$?', { user: 'erin', env });
  assert.match(missing.stdout, /rc=128/, `a 404 repository: ${missing.stdout}${missing.stderr}`);
  assert.match(missing.stderr, /not found|404/i, missing.stderr);
  const w = await run(['bash', '-c', 'cat > /tmp/decoy.pem'], { cwd: '/tmp', stdin: DECOY_CA });
  assert.equal(w.status, 0, w.stderr);
  const bad = await sh('git ls-remote https://cert.test/repo.git; echo rc=$?', { user: 'erin', env: { ...env, GIT_SSL_CAINFO: '/tmp/decoy.pem' } });
  assert.match(bad.stdout, /rc=128/, `a decoy CA: ${bad.stdout}${bad.stderr}`);
  assert.doesNotMatch(bad.stdout, /refs\/heads\/main/, bad.stdout);
  assert.match(bad.stderr, /SSL certificate|not correctly signed|verif/i, bad.stderr);
  console.log('git https: erin ls-remotes and clones a dumb-HTTP repository over https (Mbed TLS, kernel CA), fsck --strict clean; a 404 is rc 128; a decoy GIT_SSL_CAINFO fails verification, rc 128');
}
