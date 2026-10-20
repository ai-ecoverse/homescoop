const HOLDER = String.raw`
h = File.open(ARGV[0], File::RDWR | File::CREAT)
h.flock(File::LOCK_EX)
h.fcntl(Fcntl::F_SETLK, [Fcntl::F_WRLCK, IO::SEEK_SET, 0, 0, 0].pack("s s x4 q q l x4")) if ARGV[1] == "fcntl"
File.write(ARGV[0] + ".ready", "")
sleep 3
`;

const CODE = String.raw`
require "timeout"; require "fcntl"
f = "/tmp/rb-intr"
ready = f + ".ready"
spawn_holder = ->(mode) { File.delete(ready) if File.exist?(ready); pid = Process.spawn("ruby", "-rfcntl", "/tmp/rb-intr-holder.rb", f, mode); sleep 0.05 until File.exist?(ready); pid }
mono = -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
o = []
pid = spawn_holder.("flock")
t0 = mono.()
h = File.open(f, "r+")
x = begin; Timeout.timeout(1) { h.flock(File::LOCK_EX) }; "locked"; rescue Timeout::Error; "Timeout::Error"; ensure h.close; end
o << "timeout=#{x}:#{mono.() - t0 < 1.5 ? "prompt" : "late"}"
t0 = mono.()
h = File.open(f, "r+")
th = Thread.new { h.flock(File::LOCK_EX) }
sleep 0.3
th.kill; th.join; h.close
o << "kill-flock=#{th.status.inspect}:#{mono.() - t0 < 1.5 ? "prompt" : "late"}"
Process.wait(pid)
o << "after=#{File.open(f, "r+") { |a| a.flock(File::LOCK_EX | File::LOCK_NB) }}"
pid = spawn_holder.("fcntl")
t0 = mono.()
h = File.open(f, "r+")
th = Thread.new { h.fcntl(Fcntl::F_SETLKW, [Fcntl::F_WRLCK, IO::SEEK_SET, 0, 0, 0].pack("s s x4 q q l x4")) }
sleep 0.3
th.kill; th.join; h.close
o << "kill-setlkw=#{th.status.inspect}:#{mono.() - t0 < 1.5 ? "prompt" : "late"}"
t0 = mono.()
r = File.open(f, "r+") { |a| a.fcntl(Fcntl::F_SETLKW, [Fcntl::F_WRLCK, IO::SEEK_SET, 0, 0, 0].pack("s s x4 q q l x4")) }
o << "setlkw-waits=#{r}:#{mono.() - t0 > 1.5 ? "waited" : "at-once"}"
Process.wait(pid)
puts o.join(" | ")
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/rb-intr-holder.rb', HOLDER);
  const r = await run(['ruby', '-e', CODE], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), 'timeout=Timeout::Error:prompt | kill-flock=false:prompt | after=0 | kill-setlkw=false:prompt | setlkw-waits=0:waited',
    `Timeout and Thread#kill interrupt a blocking File#flock and IO#fcntl(F_SETLKW) (homescoop#869): ${r.stdout}${r.stderr}`);
  console.log(`flock interrupt: ${r.stdout.trim()}`);
}
