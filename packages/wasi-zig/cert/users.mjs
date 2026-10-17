export default async function (ctx) {
  const { run, write, read, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const prog = (msg) => `const std = @import("std");\npub fn main() void { std.debug.print("${msg}\\n", .{}); }\n`;
  await write('home/bob/src/secret.zig', prog('bob-secret-7731'));
  await write('home/bob/src/open.zig', prog('bob-open'));
  await write('home/alice/hi.zig', prog('hi from alice'));
  const setup = await run(['bash', '-c', [
    `chown -R ${bob.uid}:${bob.gid} /home/bob/src`,
    `chown ${alice.uid}:${alice.gid} /home/alice/hi.zig`,
    'chmod 755 /home/bob /home/bob/src',
    'chmod 600 /home/bob/src/secret.zig',
    'chmod 644 /home/bob/src/open.zig',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const as = (argv, user) => run(argv, { cwd: `/home/${user}`, user });
  const zig = (args, user) => as(['zig', 'build-exe', ...args, '-target', 'wasm32-wasi'], user);

  let r = await zig(['hi.zig'], 'alice');
  assert.equal(r.status, 0, `alice builds in her home: ${out(r)}`);
  r = await as(['/home/alice/hi.wasm'], 'alice');
  assert.equal(r.stderr, 'hi from alice\n', out(r));
  r = await run(['stat', '-c', '%u:%g %n', '/home/alice/hi.wasm'], { cwd: '/home' });
  assert.equal(r.stdout, `${alice.uid}:${alice.gid} /home/alice/hi.wasm\n`, `alice's output is hers: ${out(r)}`);

  r = await zig(['/home/bob/src/secret.zig'], 'alice');
  assert.notEqual(r.status, 0, `alice can't build bob's 0600 source: ${out(r)}`);
  assert.match(r.stderr, /AccessDenied|PermissionDenied|Permission denied/, out(r));
  assert.ok(!(await read('home/alice/secret.wasm')), 'no program built from a refused source');

  r = await zig(['/home/bob/src/open.zig', '-femit-bin=/home/bob/src/alice.wasm'], 'alice');
  assert.notEqual(r.status, 0, `alice can't write into bob's 0755 directory: ${out(r)}`);
  r = await run(['ls', '/home/bob/src'], { cwd: '/home' });
  assert.equal(r.stdout, 'open.zig\nsecret.zig\n', `alice left nothing in bob's directory: ${out(r)}`);

  r = await zig(['/home/bob/src/open.zig'], 'alice');
  assert.equal(r.status, 0, `alice builds bob's 0644 source into her home: ${out(r)}`);
  r = await as(['/home/alice/open.wasm'], 'alice');
  assert.equal(r.stderr, 'bob-open\n', out(r));
  console.log("users: alice builds in her home (output hers), is refused bob's 0600 source and his directory, builds his 0644 one");
}
