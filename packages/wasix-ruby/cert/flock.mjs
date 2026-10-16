const GEMFILE = 'source "https://rubygems.org"\ngem "json"\n';
const TRACE = 'class File; alias_method :homescoop_flock, :flock; def flock(op); r = homescoop_flock(op); $stderr.puts "FLOCK #{File.basename(path)} #{op} #{r}"; r; end; end\n';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /EINVAL|rb_file_flock/, `${script}: flock failed: ${r.stdout}${r.stderr}`);
    return { out: r.stdout, err: r.stderr };
  };
  const direct = await sh(`ruby -e 'File.open("/tmp/flock-direct", "w") { |f| print [f.flock(File::LOCK_EX), f.flock(File::LOCK_EX | File::LOCK_NB), f.flock(File::LOCK_SH | File::LOCK_NB), f.flock(File::LOCK_UN)].join(" ") }'`);
  assert.equal(direct.out, '0 0 0 0', `File#flock LOCK_EX, LOCK_EX|LOCK_NB, LOCK_SH|LOCK_NB, LOCK_UN each return 0 (patches/flock-wasi-noop.patch): ${direct.out}${direct.err}`);
  await write('/tmp/flock-trace.rb', TRACE);
  await write('/tmp/flock-bundle/Gemfile', GEMFILE);
  const bundle = await sh('cd /tmp/flock-bundle && bundle config set --local path vendor/bundle >/dev/null && RUBYOPT=-r/tmp/flock-trace.rb bundle install --local 2>&1 && test -f Gemfile.lock && ruby -e "print File.read(%q(Gemfile.lock))[/^    json \\(.*\\)$/]"');
  assert.match(bundle.out, /^FLOCK bundler\.lock \d+ 0$/m, `bundle install --local takes its process lock (vendor/bundle/ruby/3.4.0/bundler.lock) with File#flock: ${bundle.out}`);
  assert.match(bundle.out, /Bundle complete! 1 Gemfile dependency/, `bundle install --local completes: ${bundle.out}`);
  assert.match(bundle.out, / {4}json \(\d+\.\d+\.\d+\)$/, `Gemfile.lock names json: ${bundle.out}`);
  const gem = await sh('cd /tmp && RUBYOPT=-r/tmp/flock-trace.rb gem install --local --no-document --install-dir /tmp/flock-gems "$(ruby -e "print Dir[File.join(Gem.default_dir, %q(cache), %q(rake-*.gem))].first")" 2>&1 && test -x /tmp/flock-gems/bin/rake');
  assert.match(gem.out, /^FLOCK rake\.lock \d+ 0$/m, `gem install writes its binstub under a File#flock lock (bin/rake.lock): ${gem.out}`);
  assert.match(gem.out, /Successfully installed rake-13\.\d+\.\d+/, `gem install --local rake: ${gem.out}`);
  console.log(`flock: File#flock ${direct.out}; bundle install --local and gem install --local lock with flock and complete`);
}
