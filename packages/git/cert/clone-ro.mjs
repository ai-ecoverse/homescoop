export default async function cloneReadOnly(ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'dora' });
  const r = await run(
    [
      'bash',
      '-c',
      [
        'cd ~ && git init -q -b main r && cd r && git config user.email d@x && echo a > f && git add f && git commit -qm one && cd ..',
        'mkdir ro && chmod 0555 ro',
        'git clone -q -l r ro/c; echo rc=$?',
        'test -e ro/c && echo made || echo none',
      ].join(' && '),
    ],
    { cwd: '/tmp', user: 'dora' },
  );
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, 'rc=128\nnone\n', `git clone --local into a 0555 directory still dies (clone-local-no-hardlinks.patch copies only where link() can't be made): ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /fatal: .*ro\/c.*Permission denied/, r.stderr);
  console.log('git clone-ro: dora\'s git clone --local into her 0555 directory dies, rc 128, Permission denied, nothing made');
}
