/** git: local bare-repo push / clone / fetch. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  const git = async (args) => {
    const r = await run(['git', ...args], { cwd: '/home' });
    assert.equal(r.status, 0, `git ${args.join(' ')} stderr=${r.stderr}`);
    return r;
  };

  await git(['init', '--bare', '/home/bare.git']);
  await git(['-C', '/home/bare.git', 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  await git(['clone', '/home/bare.git', '/home/work']);
  await write('home/work/README', 'homescoop-git-cert\n');
  await git(['-C', '/home/work', 'config', 'user.email', 'cert@homescoop.test']);
  await git(['-C', '/home/work', 'config', 'user.name', 'Homescoop Cert']);
  await git(['-C', '/home/work', 'add', 'README']);
  await git(['-C', '/home/work', 'commit', '-m', 'cert']);
  await git(['-C', '/home/work', 'branch', '-M', 'main']);
  await git(['-C', '/home/work', 'push', '-u', 'origin', 'main']);

  await git(['clone', '/home/bare.git', '/home/work2']);
  const show = await git(['-C', '/home/work2', 'show', 'HEAD:README']);
  assert.equal(show.stdout, 'homescoop-git-cert\n');

  await write('home/work/README', 'homescoop-git-cert-2\n');
  await git(['-C', '/home/work', 'add', 'README']);
  await git(['-C', '/home/work', 'commit', '-m', 'cert2']);
  await git(['-C', '/home/work', 'push']);
  await git(['-C', '/home/work2', 'fetch', 'origin']);
  await git(['-C', '/home/work2', 'merge', 'FETCH_HEAD']);
  const show2 = await git(['-C', '/home/work2', 'show', 'HEAD:README']);
  assert.equal(show2.stdout, 'homescoop-git-cert-2\n');
}
