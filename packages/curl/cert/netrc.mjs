async function responder(req) {
  const auth = ((req.headers || []).find(([k]) => k.toLowerCase() === 'authorization') || [])[1];
  return { headers: [['content-type', 'text/plain']], body: `auth=${auth || 'none'}\n` };
}

export default async function (ctx) {
  const { run, assert, addUser, serve } = ctx;
  await addUser({ name: 'alice' });
  await serve(responder);
  const r = await run(['bash', '-c', [
    "printf 'machine example.test login u password p\\n' > ~/.netrc; chmod 600 ~/.netrc",
    'echo "home: $(curl -sS -n http://example.test/auth; echo rc=$?)"',
    'echo "nohome: $(env -u HOME curl -sS -n http://example.test/auth 2>&1; echo rc=$?)"',
    'echo "root-netrc: $(env -u HOME curl -sS --netrc-file /home/alice/.netrc http://example.test/auth; echo rc=$?)"',
  ].join('\n')], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^home: auth=Basic dTpw\nrc=0$/m, `curl -n with HOME set: ${r.stdout}`);
  assert.match(r.stdout, /^nohome: auth=Basic dTpw\nrc=0$/m, `curl -n with HOME unset finds ~/.netrc through the passwd home (homescoop#724; 8.22.0-7: rc 26 .netrc error): ${r.stdout}${r.stderr}`);
  console.log(`netrc: ${r.stdout.trim().replace(/\n/g, ' ')}`);
}
