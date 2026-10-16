const GEMSPEC = `Gem::Specification.new do |s|
  s.name = "hello"
  s.version = "1.0.0"
  s.summary = "hello"
  s.authors = ["homescoop"]
  s.license = "MIT"
  s.files = ["exe/hello"]
  s.bindir = "exe"
  s.executables = ["hello"]
end
`;
const EXE = `#!/usr/bin/env ruby
puts "hello #{ARGV.join(",")}"
exit 7
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = async (script, want = 0) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, want, `${script}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const interp = await sh(`ruby -e 'print Gem.ruby == RbConfig.ruby, " ", Gem.ruby; system(Gem.ruby, "-e", "exit 3"); print " ", $?.exitstatus'`);
  assert.equal(interp, 'true /usr/bin/ruby 3', `Gem.ruby: ${interp}`);
  const own = await sh(`ruby -e 'b = File.join(RbConfig::CONFIG["bindir"], "ruby"); print File.binread(b, 4).unpack1("H*"), " ", File.executable?(b); system(b, "-e", "require %q(json); exit JSON.parse(%q([4])).first"); print " ", $?.exitstatus'`);
  assert.equal(own, '0061736d true 4', `bin/ruby: ${own}`);
  const bin = await sh(`ruby -e 'print RbConfig::CONFIG["bindir"]'`);
  const scripts = await sh(`for s in gem rake bundle; do head -n 1 ${bin}/$s; done; ${bin}/rake --version; ${bin}/gem --version >/dev/null && echo gem-ok`);
  assert.match(scripts, /^(#!\/usr\/bin\/env ruby\n){3}rake, version 13\.\d+\.\d+\ngem-ok$/, `package scripts by path: ${scripts}`);
  await write('/tmp/hello/hello.gemspec', GEMSPEC);
  await write('/tmp/hello/exe/hello', EXE);
  await sh('cd /tmp/hello && gem build hello.gemspec >/dev/null && gem install --local ./hello-1.0.0.gem >/dev/null');
  const gems = await sh(`ruby -e 'print Gem.bindir'`);
  assert.equal(await sh(`head -n 1 ${gems}/hello`), '#!/usr/bin/ruby', 'installed gem executable shebang');
  assert.equal(await sh(`${gems}/hello a b`, 7), 'hello a,b', 'gem executable by path from bash');
  assert.equal(await sh(`PATH=${gems}:$PATH hello c`, 7), 'hello c', 'gem executable by name from bash');
  const fromRuby = await sh(`ruby -e 'system(%q(${gems}/hello), "d"); a = $?.exitstatus; ENV["PATH"] = %q(${gems}:) + ENV["PATH"]; system("hello", "e"); print a, " ", $?.exitstatus'`);
  assert.equal(fromRuby, 'hello d\nhello e\n7 7', `gem executable from ruby: ${fromRuby}`);
  const loadPath = await sh(`ruby -e 'pkg = File.expand_path("..", RbConfig::CONFIG["bindir"]); mine = $LOAD_PATH.select { |d| d.start_with?(pkg + "/") }; print mine.size, " ", mine.reject { |d| File.directory?(d) }.join(",")'`);
  assert.equal(loadPath, '2 ', `RUBYLIB names only the package's two library directories that exist (lib/ruby/3.4.0 and its wasm32-wasi), so a require probes no missing ones: ${loadPath}`);
  console.log(`launcher: ${interp}; bin/ruby ${own}; gem bindir ${gems}; package load path ${loadPath.trim()}`);
}
