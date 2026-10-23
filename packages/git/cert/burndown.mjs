export default async function (ctx) {
  const { run, assert, addUser, installed } = ctx;
  const pkg = installed[0];
  assert.equal(pkg.engines?.['slicc-kernel'], '>=1.130.2', `engines: a kernel before 1.57.0 reports every file as the caller's, so safe.directory never fired (homescoop#887): ${JSON.stringify(pkg.engines)}`);
  assert.ok(pkg.peerDependencies?.['@ai-ecoverse/wasm-sed'], `package.json names wasm-sed, which git-sh-setup runs, as a peer (homescoop#903, bios#939): ${JSON.stringify(pkg.peerDependencies)}`);
  await addUser({ name: 'alice' });
  const sh = (cmd, o = {}) => run(['bash', '-c', cmd], { cwd: '/tmp', ...o });

  const own = await sh('mkdir -p /tmp/shared && cd /tmp/shared && git init -q r && chmod -R a+rwX /tmp/shared && stat -c %u /tmp/shared/r/.git/HEAD');
  assert.equal(own.status, 0, own.stderr);
  assert.equal(own.stdout.trim(), '0', 'root owns its repository');
  const foreign = await sh('cd /tmp/shared/r && git status; echo rc=$?', { user: 'alice' });
  assert.match(foreign.stdout + foreign.stderr, /detected dubious ownership in repository at '\/tmp\/shared\/r'/, `alice runs git in root's repository: safe.directory must refuse it (homescoop#887): ${foreign.stdout}${foreign.stderr}`);
  assert.match(foreign.stdout, /rc=128/);

  const sub = await sh(
    [
      'cd /root && git init -q -b main src && cd src && git config user.email r@x && echo s > s && git add s && git commit -qm s',
      'cd /root && git init -q -b main sup && cd sup && git config user.email r@x',
      'git -c protocol.file.allow=always submodule add -q /root/src sub',
      'git commit -qm "add sub"',
      "git submodule status | sed 's/^.[0-9a-f]* //'",
      'cat sub/s',
    ].join(' && '),
  );
  assert.equal(sub.status, 0, `git submodule add (a shell-script subcommand, git-sh-setup uses sed; homescoop#903): ${sub.stdout}${sub.stderr}`);
  assert.equal(sub.stdout, 'sub (heads/main)\ns\n', JSON.stringify(sub.stdout));

  const clone = await sh(
    [
      'cd /root && git init -q -b main lr && cd lr && git config user.email a@b && echo a > f && git add f && git commit -qm one && cd ..',
      'git clone -q --local lr c2',
      'cat c2/f',
      'git -C c2 fsck --no-progress 2>&1 | wc -l',
    ].join(' && '),
  );
  assert.equal(clone.status, 0, `git clone --local on a file system with no hard links copies (homescoop#912): ${clone.stdout}${clone.stderr}`);
  assert.equal(clone.stdout, 'a\n0\n');
  console.log("git burndown: alice is refused root's repository (dubious ownership, rc 128); git submodule add runs (sed); git clone --local copies where hard links fail");
}
