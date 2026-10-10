/**
 * wasix-ruby file modes (homescoop#169): built on wasix-sysroot 2025.9.30-17,
 * whose libc sets and reads modes through slicc-kernel's slicc_fs imports
 * (1.35.1). File.umask, File.chmod, Dir.mkdir modes, Tempfile 600 and
 * Dir.mktmpdir 700 hold, and File.stat sees the same bits as coreutils.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/ruby-modes';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const r = await run(['ruby', '-rtempfile', '-rtmpdir', '-e', `
    old = File.umask(0o027)
    File.write("grp", "x")
    File.umask(0o022)
    tf = Tempfile.create("tf", ".") { |f| f.path }
    t = Tempfile.create("keep", "."); tfp = File.basename(t.path); t.close  # no block: kept after exit
    td = File.basename(Dir.mktmpdir("td", "."))
    Dir.mkdir("priv", 0o700)
    File.write("exe", ""); File.chmod(0o755, "exe")
    printf("old %03o\\n", old)
    puts "tf #{tfp}", "td #{td}"
    %W[grp #{tfp} #{td} priv exe].each { |f| printf("in %s %o\\n", f, File.stat(f).mode & 0o7777) }
    puts File.executable?("exe") ? "exe is executable" : "exe is not executable"
  `], { cwd });
  assert.equal(r.status, 0, `ruby rc=${r.status} stderr=${r.stderr}`);
  const tf = r.stdout.match(/^tf (\S+)$/m)?.[1];
  const td = r.stdout.match(/^td (\S+)$/m)?.[1];
  assert.ok(tf && td, r.stdout);
  assert.match(r.stdout, /^old 022$/m);
  const want = { grp: '640', [tf]: '600', [td]: '700', priv: '700', exe: '755' };
  const st = await run(['stat', '-c', '%a %n', ...Object.keys(want)], { cwd });
  assert.equal(st.status, 0, st.stderr);
  assert.deepEqual(Object.fromEntries(st.stdout.trim().split('\n').map((l) => l.split(' ').reverse())), want);
  for (const [f, m] of Object.entries(want)) assert.match(r.stdout, new RegExp(`^in ${f} ${m}$`, 'm'), `ruby stat ${f}`);
  assert.match(r.stdout, /^exe is executable$/m);
}
