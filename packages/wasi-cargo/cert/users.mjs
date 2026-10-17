export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const crate = (name) => ({
    'Cargo.toml': `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`,
    'src/main.rs': `fn main() { println!("built by ${name}"); }\n`,
  });
  for (const [owner, name] of [['alice', 'mine'], ['bob', 'theirs']]) {
    for (const [path, text] of Object.entries(crate(name))) await write(`home/${owner}/${name}/${path}`, text);
  }
  const setup = await run(['bash', '-c', [
    `chown -R ${alice.uid}:${alice.gid} /home/alice/mine`,
    `chown -R ${bob.uid}:${bob.gid} /home/bob/theirs`,
    'chmod -R go-w /home/bob/theirs',
    'chmod 755 /home/bob',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  let r = await run(['cargo', 'run', '--offline', '--release'], { cwd: '/home/alice/mine', user: 'alice' });
  assert.equal(r.status, 0, `alice builds her crate: ${out(r)}`);
  assert.equal(r.stdout, 'built by mine\n');
  r = await run(['stat', '-c', '%u:%g', '/home/alice/mine/target/wasm32-wasip1/release/mine.wasm'], { cwd: '/home' });
  assert.equal(r.stdout, `${alice.uid}:${alice.gid}\n`, `alice's target is hers: ${out(r)}`);

  r = await run(['cargo', 'build', '--offline', '--release'], { cwd: '/home/bob/theirs', user: 'alice' });
  assert.notEqual(r.status, 0, `alice can't build in bob's read-only crate: ${out(r)}`);
  assert.match(r.stderr, /Permission denied/, out(r));
  r = await run(['ls', '/home/bob/theirs'], { cwd: '/home' });
  assert.equal(r.stdout, 'Cargo.toml\nsrc\n', `no target/ or Cargo.lock left in bob's crate: ${out(r)}`);

  r = await run(['cargo', 'run', '--offline', '--release', '--target-dir', '/home/alice/bob-target'], { cwd: '/home/bob/theirs', user: 'alice' });
  assert.equal(r.status, 101, `--target-dir doesn't let alice write bob's Cargo.lock: ${out(r)}`);
  assert.match(r.stderr, /failed to write \/home\/bob\/theirs\/Cargo\.lock/, out(r));
  console.log("users: alice builds her crate (target hers) and is refused bob's read-only one");
}
