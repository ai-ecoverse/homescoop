export default async function (ctx) {
  const { run, write, read, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  await write('home/bob/src/secret.rs', 'fn main() { println!("bob-secret-7731"); }\n');
  await write('home/bob/src/open.rs', 'fn main() { println!("bob-open"); }\n');
  await write('home/alice/hi.rs', 'fn main() { println!("hi from alice"); }\n');
  const setup = await run(['bash', '-c', [
    `chown -R ${bob.uid}:${bob.gid} /home/bob/src`,
    `chown ${alice.uid}:${alice.gid} /home/alice/hi.rs`,
    'chmod 755 /home/bob /home/bob/src',
    'chmod 600 /home/bob/src/secret.rs',
    'chmod 644 /home/bob/src/open.rs',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const as = (argv, user) => run(argv, { cwd: `/home/${user}`, user });

  let r = await as(['rustc', 'hi.rs', '-o', 'hi.wasm'], 'alice');
  assert.equal(r.status, 0, `alice compiles in her home: ${out(r)}`);
  r = await as(['/home/alice/hi.wasm'], 'alice');
  assert.equal(r.stdout, 'hi from alice\n', out(r));
  r = await run(['stat', '-c', '%u:%g %n', '/home/alice/hi.wasm'], { cwd: '/home' });
  assert.equal(r.stdout, `${alice.uid}:${alice.gid} /home/alice/hi.wasm\n`, `alice's output is hers: ${out(r)}`);

  r = await as(['rustc', '/home/bob/src/secret.rs', '-o', 'stolen.wasm'], 'alice');
  assert.equal(r.status, 1, `alice can't compile bob's 0600 source: ${out(r)}`);
  assert.match(r.stderr, /couldn't read `\/home\/bob\/src\/secret\.rs`: Permission denied/, out(r));
  assert.equal(await read('home/alice/stolen.wasm'), null, 'nothing written for a refused source');

  r = await as(['rustc', '/home/bob/src/open.rs', '-o', '/home/bob/src/alice.wasm'], 'alice');
  assert.equal(r.status, 1, `alice can't write into bob's 0755 directory: ${out(r)}`);
  assert.match(r.stderr, /Permission denied/, out(r));
  r = await run(['ls', '/home/bob/src'], { cwd: '/home' });
  assert.equal(r.stdout, 'open.rs\nsecret.rs\n', `alice left nothing in bob's directory: ${out(r)}`);

  r = await as(['rustc', '/home/bob/src/open.rs', '-o', 'open.wasm'], 'alice');
  assert.equal(r.status, 0, `alice compiles bob's 0644 source into her home: ${out(r)}`);
  r = await as(['/home/alice/open.wasm'], 'alice');
  assert.equal(r.stdout, 'bob-open\n', out(r));

  r = await run(['rustc', '/home/bob/src/secret.rs', '-o', '/root/secret.wasm'], { cwd: '/root' });
  assert.equal(r.status, 0, `root compiles bob's 0600 source: ${out(r)}`);
  console.log("users: alice compiles in her home (output hers), is refused bob's 0600 source and his directory, compiles his 0644 one; root reads everything");
}
