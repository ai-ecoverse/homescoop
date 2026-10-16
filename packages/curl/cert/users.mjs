/**
 * curl under users enforce (#723). 8.22.0-5 links the slicc credentials
 * (slicc_cred_js), so the files it opens (file:// URLs, -d @file, -K, -o)
 * are opened as the caller, and the files it creates carry the caller's ids.
 *
 * alice (1000) and bob (1001) each have a 0700 home; bob's s.txt is 0600.
 */
async function responder(req) {
  const body = req.body ? (typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body)) : '';
  return { headers: [['content-type', 'text/plain']], body: `got ${req.method} ${new URL(req.url).pathname} [${body}]\n` };
}

export default async function (ctx) {
  const { run, assert, addUser, serve } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  await serve(responder);
  const setup = await run(['bash', '-c', [
    'printf "bob secret\\n" > /home/bob/s.txt',
    `chown ${bob.uid}:${bob.gid} /home/bob/s.txt && chmod 600 /home/bob/s.txt && chmod 700 /home/bob /home/alice`,
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stderr}`);
  const curl = (args, user) => run(['curl', '-sS', ...args], { cwd: user ? `/home/${user}` : '/root', ...(user && { user }) });

  // root reads bob's file every way.
  let r = await curl(['file:///home/bob/s.txt']);
  assert.equal(r.status, 0, `root: file://: rc=${r.status} ${r.stderr}`);
  assert.equal(r.stdout, 'bob secret\n', 'root: curl file:// of bob\'s 0600');
  r = await curl(['-d', '@/home/bob/s.txt', 'http://example.test/echo']);
  assert.equal(r.stdout, 'got POST /echo [bob secret]\n', `root: curl -d @bob's file: ${r.stderr}`);

  // alice is refused bob's 0600 file and bob's 0700 home.
  r = await curl(['file:///home/bob/s.txt'], 'alice');
  assert.equal(r.status, 37, `alice: file:// of bob's 0600: rc=${r.status} ${r.stdout}`);
  assert.equal(r.stdout, '', 'alice: file:// prints nothing');
  assert.match(r.stderr, /\(37\) Could not open file \/home\/bob\/s\.txt/, `alice: file:// stderr`);
  r = await curl(['-d', '@/home/bob/s.txt', 'http://example.test/echo'], 'alice');
  assert.equal(r.status, 26, `alice: -d @bob's file: rc=${r.status} ${r.stdout}`);
  assert.match(r.stderr, /Failed to open \/home\/bob\/s\.txt/, 'alice: -d @file stderr');
  r = await curl(['-K', '/home/bob/s.txt', 'http://example.test/x'], 'alice');
  assert.equal(r.status, 26, `alice: -K bob's file: rc=${r.status}`);
  assert.match(r.stderr, /cannot read config from '\/home\/bob\/s\.txt'/, 'alice: -K stderr');
  r = await curl(['-o', '/home/bob/x.txt', 'http://example.test/x'], 'alice');
  assert.equal(r.status, 23, `alice: -o into bob's 0700 home: rc=${r.status} ${r.stderr}`);
  const absent = await run(['bash', '-c', 'test ! -e /home/bob/x.txt && cat /home/bob/s.txt']);
  assert.equal(absent.stdout, 'bob secret\n', `alice's -o made no file in bob's home, s.txt intact: ${absent.stderr}`);

  // alice's own output files are alice's.
  r = await curl(['-o', 'got.txt', 'http://example.test/x'], 'alice');
  assert.equal(r.status, 0, `alice: -o got.txt: rc=${r.status} ${r.stderr}`);
  r = await run(['bash', '-c', 'umask 022; cd /tmp && curl -sS -O http://example.test/o.txt && stat -c "%u:%g %a" /home/alice/got.txt o.txt && cat /home/alice/got.txt'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 0, `alice: -O in /tmp: rc=${r.status} ${r.stderr}`);
  assert.equal(r.stdout, `${alice.uid}:${alice.gid} 644\n${alice.uid}:${alice.gid} 644\ngot GET /x []\n`, "alice: -o / -O files are alice's");
  r = await run(['cat', '/home/alice/got.txt']);
  assert.equal(r.stdout, 'got GET /x []\n', "root reads alice's output");
  console.log("users: alice's curl is refused bob's 0600 file (file:// 37, -d @ 26, -K 26) and bob's 0700 home (-o 23); her -o/-O files are hers; root reads both");
}
