/**
 * File#flock (homescoop#420, #578). Up to 3.4.11-16 missing/flock.c's
 * __wasi__ branch answered every flock with 0 (patches/flock-wasi-noop.patch),
 * so it excluded nobody: two `bundle install`s on one bundle path raced. Since
 * 3.4.11-17 (patches/flock-wasi-fcntl.patch) it took whole-file fcntl record
 * locks (F_SETLK / F_SETLKW), which slicc-kernel enforces between processes
 * from 1.100.0 (slicc.fcntl_lock), as wasix-perl 5.42.0-15 did for #631:
 * fcntl semantics, so a lock belongs to the process (a second handle in the
 * same process isn't refused; closing any handle on the file drops it).
 * LOCK_EX on a read-only handle is a read lock (it keeps writers out), LOCK_SH
 * on a write-only one a write lock. Anything that isn't a regular file (pipe,
 * /dev/null, a directory) is granted and excludes nobody (slicc-kernel keeps
 * record locks on regular files only, slicc-kernel#757; NEGATIVE.md).
 * Since 3.4.11-18 it is libc's flock (wasix-sysroot -34, slicc.flock): per
 * open file description, on any descriptor, as on Linux.
 */
const GEMFILE = 'source "https://rubygems.org"\ngem "json"\n';
const TRACE = 'class File; alias_method :homescoop_flock, :flock; def flock(op); r = homescoop_flock(op); $stderr.puts "FLOCK #{File.basename(path)} #{op} #{r}"; r; end; end\n';

// Holds LOCK_EX on ARGV[0] until a bundle install has asked for it, then 1 s
// more (at most 60 s).
const HOLDER = String.raw`
log = ->(s) { File.write("/tmp/flock-order", s + "\n", mode: "a") }
require "fileutils"
FileUtils.mkdir_p(File.dirname(ARGV[0]))
f = File.open(ARGV[0], File::RDWR | File::CREAT)
f.flock(File::LOCK_EX)
log.("held")
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 60
sleep 0.2 until File.read("/tmp/flock-order").include?("bundle-try") || Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
sleep 1
log.("released")
f.flock(File::LOCK_UN)
`;
const ORDER_TRACE = 'class File; alias_method :homescoop_flock, :flock; def flock(op); return homescoop_flock(op) unless File.basename(path) == "bundler.lock"; File.write("/tmp/flock-order", "bundle-try\n", mode: "a"); r = homescoop_flock(op); File.write("/tmp/flock-order", "bundle-got #{r}\n", mode: "a"); r; end; end\n';

// The child: run by the parent with Process.spawn (ruby has no fork here).
const CHILD = String.raw`
f = ARGV[0]
try = ->(h, op) { r = h.flock(op); r == false ? "false" : r.to_s }
$stdout.sync = true
case ARGV[1]
when "ex"
  c = File.open(f, "r+")
  puts [try.(c, File::LOCK_EX | File::LOCK_NB), try.(c, File::LOCK_SH | File::LOCK_NB)].join(" ")
  t = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  w = try.(c, File::LOCK_EX)
  puts "#{w} #{Process.clock_gettime(Process::CLOCK_MONOTONIC) - t >= 0.8 ? "waited" : "at-once"}"
when "sh"
  c = File.open(f, "r+")
  puts [try.(c, File::LOCK_SH | File::LOCK_NB), try.(c, File::LOCK_EX | File::LOCK_NB)].join(" ")
when "wr"
  c = File.open(f, "a")
  puts try.(c, File::LOCK_EX | File::LOCK_NB)
end
`;

const PARENT = String.raw`
f = ARGV[0]
child = ARGV[1]
try = ->(h, op) { r = h.flock(op); r == false ? "false" : r.to_s }
spawn = ->(mode) { r, w = IO.pipe; pid = Process.spawn("ruby", child, f, mode, out: w); w.close; [r, pid] }
File.write(f, "x" * 16)
h = File.open(f, "r+")
same = [try.(h, File::LOCK_EX), try.(h, File::LOCK_EX | File::LOCK_NB), try.(h, File::LOCK_SH | File::LOCK_NB), try.(h, File::LOCK_EX)].join(" ")
r, pid = spawn.("ex")
refused = r.gets.chomp
sleep 1.0
unlock = try.(h, File::LOCK_UN)
blocking = r.gets.chomp.sub(" ", ":")
Process.wait(pid)
s = File.open(f, "r")
sh = try.(s, File::LOCK_SH)
r, pid = spawn.("sh"); shared = r.gets.chomp; Process.wait(pid)
s.close
ro = File.open(f, "r")
rox = try.(ro, File::LOCK_EX)
r, pid = spawn.("wr"); readonly = r.gets.chomp; Process.wait(pid)
ro.close
puts ["same=#{same}", "child=#{refused}", "unlock=#{unlock}", "blocking=#{blocking}", "shared=#{sh}:#{shared}", "readonly=#{rox}:#{readonly}"].join(" | ")
`;

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  // Files go in through the kernel (mkdir -p + cat), so every process sees them.
  const write = async (path, text) => {
    const r = await run(['bash', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'put', path], { cwd: '/tmp', stdin: text });
    assert.equal(r.status, 0, `write ${path}: ${r.stdout}${r.stderr}`);
  };
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /EINVAL|rb_file_flock/, `${script}: flock failed: ${r.stdout}${r.stderr}`);
    return { out: r.stdout, err: r.stderr };
  };
  const floor = ctx.installed?.[0]?.engines?.['slicc-kernel'];
  const fm = /^>=1\.(\d+)\.\d+$/.exec(floor ?? '');
  assert.ok(fm && Number(fm[1]) >= 117, `engines.slicc-kernel is at least >=1.117.0, the first kernel with slicc.flock: ${floor}`);

  // Between processes, as root and as a user (#578's repro is the child= field).
  await write('/tmp/ruby-flock-child.rb', CHILD);
  const want = 'same=0 0 0 0 | child=false false | unlock=0 | blocking=0:waited | shared=0:0 false | readonly=0:false';
  for (const user of [undefined, 'cone']) {
    if (user) await addUser({ name: user });
    const cwd = user ? `/home/${user}` : '/tmp';
    const r = await run(['ruby', '-e', PARENT, `${cwd}/ruby-flock`, '/tmp/ruby-flock-child.rb'], { cwd, ...(user && { user }) });
    assert.equal(r.status, 0, `${user ?? 'root'}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(r.stdout.trim(), want, `${user ?? 'root'}: File#flock between processes (a child's LOCK_EX|LOCK_NB is false while the parent holds LOCK_EX; Linux the same): ${r.stdout}${r.stderr}`);
  }

  // #578's one-liner: a popen'ed ruby can't take the lock the parent holds.
  const popen = await sh(`ruby -e 'g = File.open("/tmp/fl", "w"); g.flock(File::LOCK_EX); print IO.popen(["ruby", "-e", "print File.open(%q(/tmp/fl), %q(w)).flock(File::LOCK_EX | File::LOCK_NB).inspect"], &:read)'`);
  assert.equal(popen.out, 'false', `#578: a second process's LOCK_EX|LOCK_NB while the first holds LOCK_EX: ${popen.out}${popen.err}`);

  // Not a regular file: granted, excluding nobody (slicc-kernel#757).
  const other = await sh(String.raw`ruby -e 'r, w = IO.pipe; n = File.open("/dev/null", "w"); d = File.open("/tmp"); $stderr.puts [w, r, $stdout, n, d].map { |io| h = File.for_fd(io.fileno, autoclose: false); [File::LOCK_EX, File::LOCK_SH | File::LOCK_NB, File::LOCK_UN].map { |op| h.flock(op).inspect }.join(",") }.join(" ")' | cat`);
  assert.equal(other.err, `${Array(5).fill('0,0,0').join(' ')}\n`, `File#flock on a pipe's ends, STDOUT through a pipe, /dev/null and a directory: ${other.err}`);

  // 3.4.11-18: libc's flock, per open file description. A pipe's other end is
  // another description and conflicts (-17 granted every lock on a pipe).
  const pipe = await sh(String.raw`ruby -e 'r, w = IO.pipe; wf = File.for_fd(w.fileno, autoclose: false); rf = File.for_fd(r.fileno, autoclose: false); a = wf.flock(File::LOCK_EX); b = rf.flock(File::LOCK_EX | File::LOCK_NB); wf.flock(File::LOCK_UN); c = rf.flock(File::LOCK_EX | File::LOCK_NB); print [a, b, c].map(&:inspect).join(" ")'`);
  assert.equal(pipe.out, '0 false 0', `File#flock on a pipe's two ends: ${pipe.out}${pipe.err}`);

  // bundler and rubygems still lock with File#flock and complete.
  await write('/tmp/flock-trace.rb', TRACE);
  await write('/tmp/flock-bundle/Gemfile', GEMFILE);
  const bundle = await sh('cd /tmp/flock-bundle && bundle config set --local path vendor/bundle >/dev/null && RUBYOPT=-r/tmp/flock-trace.rb bundle install --local 2>&1 && test -f Gemfile.lock && ruby -e "print File.read(%q(Gemfile.lock))[/^    json \\(.*\\)$/]"');
  assert.match(bundle.out, /^FLOCK bundler\.lock \d+ 0$/m, `bundle install --local takes its process lock (vendor/bundle/ruby/3.4.0/bundler.lock) with File#flock: ${bundle.out}`);
  assert.match(bundle.out, /Bundle complete! 1 Gemfile dependency/, `bundle install --local completes: ${bundle.out}`);
  assert.match(bundle.out, / {4}json \(\d+\.\d+\.\d+\)$/, `Gemfile.lock names json: ${bundle.out}`);
  const gem = await sh('cd /tmp && RUBYOPT=-r/tmp/flock-trace.rb gem install --local --no-document --install-dir /tmp/flock-gems "$(ruby -e "print Dir[File.join(Gem.default_dir, %q(cache), %q(rake-*.gem))].first")" 2>&1 && test -x /tmp/flock-gems/bin/rake');
  assert.match(gem.out, /^FLOCK rake\.lock \d+ 0$/m, `gem install writes its binstub under a File#flock lock (bin/rake.lock): ${gem.out}`);
  assert.match(gem.out, /Successfully installed rake-13\.\d+\.\d+/, `gem install --local rake: ${gem.out}`);

  // A second bundle install on the same bundle path waits for the process
  // that holds bundler.lock: the holder lets go 1 s after bundle install has
  // called flock, and that flock returns only after the release (bundler
  // tries LOCK_NB first, which is false while the holder has it).
  await write('/tmp/flock-order.rb', ORDER_TRACE);
  await write('/tmp/flock-holder.rb', HOLDER);
  await write('/tmp/flock-bundle2/Gemfile', GEMFILE);
  const waits = await sh([
    'cd /tmp/flock-bundle2 && : > /tmp/flock-order && bundle config set --local path vendor/bundle >/dev/null',
    'ruby /tmp/flock-holder.rb vendor/bundle/ruby/3.4.0/bundler.lock &',
    'until [[ "$(< /tmp/flock-order)" == *held* ]]; do sleep 0.2; done',
    'RUBYOPT=-r/tmp/flock-order.rb bundle install --local >/tmp/flock-bundle2.log 2>&1',
    'wait',
    'cat /tmp/flock-order; [[ "$(< /tmp/flock-bundle2.log)" == *"Bundle complete!"* ]] && echo complete',
  ].join('\n'));
  assert.match(waits.out, /^held\n(bundle-try\nbundle-got false\n)*bundle-try\nreleased\nbundle-got 0\n(bundle-try\nbundle-got 0\n)*complete\n$/, `a second bundle install takes bundler.lock only after the holder released it: ${waits.out}${waits.err}`);
  console.log(`flock: ${want}, as root and cone; #578's popen case false; non-files granted; bundle install waits for bundler.lock; bundle and gem install complete`);
}
