const TRAP = `n = 0
Signal.trap("USR1") { n += 1 }
stop = false
ts = 3.times.map { Thread.new { x = 0; x += 1 until stop } }
20.times { Process.kill("USR1", $$); sleep 0.02 }
t = Time.now
sleep 0.05 while n < 20 && Time.now - t < 5
stop = true
ts.each(&:join)
puts "trapped #{n}"`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['ruby', '-e', TRAP], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), 'trapped 20', `USR1 with three busy threads: ${r.stdout}`);
  const s = await run(['ruby', '-e', 'pkg = File.expand_path("../..", RbConfig::CONFIG["bindir"] + "/x"); print JSON.parse(File.read(File.join(pkg, "package.json")))["description"][/wasix-sysroot [^:]+/], "|", File.read(File.join(pkg, "THIRD-PARTY-NOTICES.md"))[/wasix-sysroot [0-9.-]+/]', '-rjson'], { cwd: '/tmp' });
  assert.equal(s.status, 0, `rc=${s.status} ${s.stdout}${s.stderr}`);
  assert.equal(s.stdout.trim(), 'wasix-sysroot 2025.9.30-32|wasix-sysroot 2025.9.30-32', `toolchain record: ${s.stdout}`);
  console.log(`sysroot28: ${r.stdout.trim()}; ${s.stdout.trim()}`);
}
