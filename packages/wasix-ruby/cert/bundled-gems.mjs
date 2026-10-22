const CODE = String.raw`
require "bigdecimal"; require "bigdecimal/util"
require "racc/parser"
require "nkf"
require "syslog"
require "debug/version"
o = []
o << "bigdecimal=" + (BigDecimal("0.1") * 3).to_s + "," + BigDecimal("1").div(BigDecimal("3"), 20).to_s + "," + "1.1".to_d.class.name
o << "racc=" + Racc::Parser::Racc_Runtime_Type + "," + Racc::Parser::Racc_Main_Parsing_Routine.to_s
o << "nkf=" + NKF.nkf("-W -e -m0", "\u3042").unpack1("H*") + "," + NKF.guess("\xA4\xA2".b.force_encoding("EUC-JP")).to_s
Syslog.open("homescoop-cert") { |s| s.info("cert"); o << "syslog=" + s.opened?.to_s }
o << "debug=" + (begin; require "debug/frame_info"; DEBUGGER__::SO_VERSION + "," + (DEBUGGER__.frame_depth > 0).to_s; rescue LoadError => e; "LoadError:" + e.message; end)
o << "rbs=" + (begin; require "rbs"; RBS::Parser.parse_type("Array[Integer]").to_s; rescue LoadError => e; "LoadError:" + e.message; end)
o << "gems=" + %w[bigdecimal racc nkf syslog debug rbs].map { |n| s = Gem::Specification.find_by_name(n); "#{n}-#{s.version}:#{s.missing_extensions? ? "missing" : "built"}" }.join(",")
puts o
`;

const BUNDLE = [
  'rm -rf bgx && mkdir -p bgx && cd bgx',
  `printf 'source "https://rubygems.org"\\ngem "bigdecimal"\\ngem "racc"\\ngem "nkf"\\n' > Gemfile`,
  'bundle install --local >install.log 2>&1 || { cat install.log; exit 3; }',
  'cat Gemfile.lock',
  `bundle exec ruby -rbigdecimal/math -rracc/parser -rnkf -e 'puts "run=" + [BigMath.PI(10).round(10).to_s("F"), Racc::Parser::Racc_Runtime_Type, NKF.nkf("-W -e -m0", "\\u3042").unpack1("H*"), Gem.loaded_specs.values_at("bigdecimal", "racc", "nkf").map { |s| s.full_name }.join(",")].join(" ")'`,
].join(' && ');

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  for (const user of [undefined, 'cone']) {
    if (user) await addUser({ name: user });
    const cwd = user ? `/home/${user}` : '/tmp';
    const b = await run(['bash', '-lc', BUNDLE], { cwd, ...(user && { user }) });
    const bout = `${user ?? 'root'}: rc=${b.status}\n${b.stdout}${b.stderr}`;
    assert.equal(b.status, 0, `bundle install --local and bundle exec with the bundled C-extension gems (homescoop#1017): ${bout}`);
    assert.doesNotMatch(b.stdout + b.stderr, /GemNotFound|Could not find/, bout);
    assert.equal(b.stdout.split('\n').filter((l) => /^    (bigdecimal|racc|nkf) /.test(l)).map((l) => l.trim()).join(','), 'bigdecimal (3.1.8),nkf (0.2.0),racc (1.8.1)', `Gemfile.lock pins the package's gems: ${bout}`);
    assert.match(b.stdout, /^run=3\.1415926536 c a4a2 bigdecimal-3\.1\.8,racc-1\.8\.1,nkf-0\.2\.0$/m, `bundle exec ruby -rbigdecimal/math loads the package's gems: ${bout}`);
  }
  const r = await run(['ruby', '-W1', '-e', CODE], { cwd: '/tmp' });
  const out = `rc=${r.status}\n${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout)?.[1] ?? '';
  assert.equal(get('bigdecimal'), '0.3e0,0.33333333333333333333e0,BigDecimal', `BigDecimal arithmetic:\n${out}`);
  assert.equal(get("racc"), "c,_racc_do_parse_c", `racc's parser runs on cparse:\n${out}`);
  assert.equal(get('nkf'), 'a4a2,EUC-JP', `NKF converts and guesses:\n${out}`);
  assert.equal(get('syslog'), 'true', `Syslog opens:\n${out}`);
  assert.equal(get('debug'), '1.11.0,true', `debug's extension (debug/debug.so) extends DEBUGGER__ from debug/frame_info:\n${out}`);
  assert.equal(get('rbs'), 'Array[Integer]', `rbs parses a type through rbs_extension:\n${out}`);
  assert.equal(get('gems'), 'bigdecimal-3.1.8:built,racc-1.8.1:built,nkf-0.2.0:built,syslog-0.2.0:built,debug-1.11.0:built,rbs-3.8.0:built', `the bundled gems are installed with their extensions marked built:\n${out}`);
  assert.doesNotMatch(r.stderr, /Ignoring|not part of the default gems|extensions are not built/, `no RubyGems warning:\n${out}`);
  const list = await run(['gem', 'list', '--local'], { cwd: '/tmp' });
  assert.equal(list.status, 0, `gem list: ${list.stdout}${list.stderr}`);
  const listed = list.stdout.split('\n').filter((l) => /^(bigdecimal|racc|nkf|syslog|debug|rbs) /.test(l)).join('\n');
  assert.equal(listed, 'bigdecimal (3.1.8)\ndebug (1.11.0)\nnkf (0.2.0)\nracc (1.8.1)\nrbs (3.8.0)\nsyslog (0.2.0)', `gem list: ${list.stdout}${list.stderr}`);
  console.log(`bundled gems: ${r.stdout.trim().replace(/\n/g, ' | ')}; bundle install --local and bundle exec ruby -rbigdecimal/math with bigdecimal, racc and nkf, as root and cone`);
}
