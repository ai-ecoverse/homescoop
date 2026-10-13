export default async function (ctx) {
  const { run, assert } = ctx;
  const rb = async (code) => {
    const r = await run(['ruby', '-e', code], { cwd: '/tmp' });
    assert.equal(r.status, 0, `ruby -e ${code}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const near = (t) => `(Time.now.to_i - ${t}).abs <= 5 ? "now" : "mtime=#{${t}}"`;
  const touched = await rb(`require "fileutils"; f = "/tmp/rt"; File.write(f, ""); File.utime(Time.at(1000000000), Time.at(1100000000), f); e = File.mtime(f).to_i; File.utime(nil, nil, f); u = File.mtime(f).to_i; File.utime(Time.at(1000000000), Time.at(1100000000), f); FileUtils.touch(f); t = File.mtime(f).to_i; puts [e, ${near('u')}, ${near('t')}].join(" ")`);
  assert.equal(touched, '1100000000 now now', 'File.utime explicit; File.utime(nil, nil) and FileUtils.touch set mtime to now');
  const cpu = await rb('w = Time.now; nil while Process.times.utime < 0.5 && Time.now - w < 20; t = Process.times; printf("%s utime=%.1f stime=%.1f cutime=%.1f cstime=%.1f\\n", t.utime >= 0.5 ? "reached" : "timeout", t.utime, t.stime, t.cutime, t.cstime)');
  assert.match(cpu, /^reached utime=0\.[5-9] stime=0\.0 cutime=0\.0 cstime=0\.0$/, `Process.times: ${cpu}`);
  console.log(`times: ${touched}; ${cpu}`);
}
