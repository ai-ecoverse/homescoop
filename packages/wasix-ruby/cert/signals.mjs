/**
 * wasix-ruby 3.4.11-10 (wasix-sysroot -20: the libc reports every trap
 * change to slicc-kernel through slicc.sigaction_set; -19's alarm/raise):
 * on slicc-kernel 1.47.1, 3.4.11-9 (sysroot -17, no hook) never ran
 * trap("CHLD") or trap("WINCH"), and an uncaught Interrupt exited 0, not 130
 * (thr_bthjyuf4fr's cert).
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const rb = async (name, code) => {
    await write(`/tmp/s_${name}.rb`, code);
    return run(['bash', '-c', `timeout 20 ruby /tmp/s_${name}.rb; echo "rc=$?"`], { cwd: '/tmp' });
  };
  // trap("CHLD") reaps three children: no zombie left.
  let r = await rb('chld', `n = 0
trap("CHLD") { begin; while Process.wait(-1, Process::WNOHANG); n += 1; end; rescue Errno::ECHILD; end }
3.times { Process.spawn("true") }
t = Time.now; sleep 0.05 while n < 3 && Time.now - t < 5
left = begin; Process.wait(-1, Process::WNOHANG) ? "zombie" : "none"; rescue Errno::ECHILD; "none"; end
puts "reaped #{n} left #{left}"
`);
  assert.equal(r.stdout, 'reaped 3 left none\nrc=0\n', r.stdout + r.stderr);
  // WINCH, USR1 and ALRM traps run; "IGNORE" survives TERM.
  r = await rb('traps', `h = Hash.new(0)
%w[WINCH USR1 ALRM].each { |s| trap(s) { h[s] += 1 } }
trap("TERM", "IGNORE")
%w[WINCH USR1 TERM ALRM].each { |s| Process.kill(s, $$) }
t = Time.now; sleep 0.05 while h.size < 3 && Time.now - t < 5
puts %w[WINCH USR1 ALRM].map { |s| "#{s}=#{h[s]}" }.join(" ") + " alive"
`);
  assert.equal(r.stdout, 'WINCH=1 USR1=1 ALRM=1 alive\nrc=0\n', r.stdout + r.stderr);
  // An uncaught Interrupt ends ruby by SIGINT: 130 from bash.
  r = await rb('interrupt', 'Process.kill("INT", $$); sleep 5; puts "survived"\n');
  assert.equal(r.stdout, 'rc=130\n', r.stdout + r.stderr);
  // trap("INT") in place of the default: the block runs, exit 0.
  r = await rb('int_trap', 'got = false; trap("INT") { got = true }; Process.kill("INT", $$); sleep 0.1 until got; puts "trapped"\n');
  assert.equal(r.stdout, 'trapped\nrc=0\n', r.stdout + r.stderr);
}
