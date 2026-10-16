const CHILD = String.raw`
require "fcntl"
pack = ->(t, s, l) { [t, IO::SEEK_SET, s, l, 0].pack("s s x4 q q l x4") }
try = ->(f, cmd, t, s, l) { begin; f.fcntl(cmd, pack.(t, s, l)); "ok"; rescue SystemCallError => e; e.class.name.sub("Errno::", ""); end }
f = File.open("/tmp/ruby-locks", "r+")
out = [try.(f, Fcntl::F_SETLK, Fcntl::F_WRLCK, 0, 5), try.(f, Fcntl::F_SETLK, Fcntl::F_WRLCK, 5, 5), try.(f, Fcntl::F_SETLK, Fcntl::F_RDLCK, 20, 5), try.(f, Fcntl::F_SETLK, Fcntl::F_WRLCK, 20, 5)]
g = pack.(Fcntl::F_WRLCK, 0, 5)
f.fcntl(Fcntl::F_GETLK, g)
t, _, s, l, pid = g.unpack("s s x4 q q l x4")
out << "#{t}:#{s}+#{l}" + (t == Fcntl::F_UNLCK ? "" : pid == Integer(ARGV[0]) ? ":parent" : ":pid#{pid}")
$stdout.sync = true
puts out.join(" ")
started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
w = try.(f, Fcntl::F_SETLKW, Fcntl::F_WRLCK, 0, 5)
puts "#{w} #{Process.clock_gettime(Process::CLOCK_MONOTONIC) - started >= 0.8 ? "waited" : "at-once"}"
`;

const PARENT = String.raw`
require "fcntl"
pack = ->(t, s, l) { [t, IO::SEEK_SET, s, l, 0].pack("s s x4 q q l x4") }
try = ->(f, cmd, t, s, l) { begin; f.fcntl(cmd, pack.(t, s, l)); "ok"; rescue SystemCallError => e; e.class.name.sub("Errno::", ""); end }
consts = [Fcntl::F_GETLK, Fcntl::F_SETLK, Fcntl::F_SETLKW, Fcntl::F_RDLCK, Fcntl::F_WRLCK, Fcntl::F_UNLCK].join(",")
f = File.open("/tmp/ruby-locks", "w+")
f.write("x" * 40)
f.flush
parent = [try.(f, Fcntl::F_SETLK, Fcntl::F_WRLCK, 0, 5), try.(f, Fcntl::F_SETLKW, Fcntl::F_RDLCK, 20, 5), try.(f, Fcntl::F_SETLK, 7, 0, 5)].join(",")
q = pack.(Fcntl::F_WRLCK, 0, 5)
f.fcntl(Fcntl::F_GETLK, q)
t, _, s, l = q.unpack("s s x4 q q l x4")
r, w = IO.pipe
pid = Process.spawn("ruby", "/tmp/ruby-locks-child.rb", Process.pid.to_s, out: w)
w.close
child = r.gets.chomp
sleep 1.0
unlock = try.(f, Fcntl::F_SETLK, Fcntl::F_UNLCK, 0, 5)
waited = r.gets.chomp.split.then { |a, b| "#{a}:#{b}" }
Process.wait(pid)
puts ["consts=#{consts}", "parent=#{parent} own=#{t}:#{s}+#{l}", "child=#{child}", "unlock=#{unlock}", "setlkw=#{waited}"].join(" | ")
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/ruby-locks-child.rb', CHILD);
  const r = await run(['ruby', '-e', PARENT], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const kv = ctx.kernel?.version ?? '';
  const [maj, min] = kv.split('.').map(Number);
  const real = maj > 1 || (maj === 1 && min >= 100);
  const want = real
    ? 'consts=12,13,14,0,1,2 | parent=ok,ok,EINVAL own=2:0+5 | child=EAGAIN ok ok EAGAIN 1:0+5:parent | unlock=ok | setlkw=ok:waited'
    : 'consts=12,13,14,0,1,2 | parent=ok,ok,EINVAL own=2:0+5 | child=ok ok ok ok 2:0+5 | unlock=ok | setlkw=ok:at-once';
  assert.equal(r.stdout.trim(), want,
    `IO#fcntl F_SETLK/F_SETLKW/F_GETLK on slicc-kernel ${kv || '(unknown)'} (${real ? 'slicc.fcntl_lock: real locks between processes' : 'no slicc.fcntl_lock: the local answer, every lock granted'}): ${r.stdout}${r.stderr}`);
  console.log(`locks (slicc-kernel ${kv}): ${r.stdout.trim()}`);
}
