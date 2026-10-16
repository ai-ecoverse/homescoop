/**
 * bundle exec (homescoop#379): Bundler's ruby_shebang? warned
 * "/usr/bin/ruby is empty" on every `bundle exec ruby …`, since slicc-kernel's
 * /usr/bin command entries were 0-byte files up to 1.106.1
 * (slicc-kernel#762). On 1.106.2 (the cert kernel) the entries are real
 * files: the command runs, exit statuses pass through, nothing is printed.
 */
const GEMFILE = 'source "https://rubygems.org"\ngem "json"\n';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/bx/Gemfile', GEMFILE);
  const r = await run(['bash', '-c', [
    'cd /tmp/bx && bundle config set --local path vendor/bundle >/dev/null && bundle install --local >/dev/null 2>&1',
    'test -s /usr/bin/ruby && echo "ruby entry non-empty"',
    `bundle exec ruby -e 'system(Gem.ruby, "-e", "exit 5"); p $?.exitstatus'`,
  ].join(' && ')], { cwd: '/tmp' });
  assert.equal(r.status, 0, `bundle exec: rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, 'ruby entry non-empty\n5\n', `bundle exec ruby: ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /is empty/, `bundle exec warns about an empty /usr/bin entry: ${r.stderr}`);
  console.log('bundle-exec: /usr/bin/ruby is a real file; bundle exec ruby runs, the child exit status 5 passes through, no "is empty" warning');
}
