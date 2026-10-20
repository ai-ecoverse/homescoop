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
o << "debug=" + (begin; require "debug/debug.so"; "so"; rescue LoadError => e; "LoadError:" + e.message; end)
o << "rbs=" + (begin; require "rbs"; RBS::Parser.parse_type("Array[Integer]").to_s; rescue LoadError => e; "LoadError:" + e.message; end)
o << "gems=" + %w[bigdecimal racc nkf syslog debug rbs].map { |n| s = Gem::Specification.find_by_name(n); "#{n}-#{s.version}:#{s.missing_extensions? ? "missing" : "built"}" }.join(",")
puts o
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['ruby', '-W1', '-e', CODE], { cwd: '/tmp' });
  const out = `rc=${r.status}\n${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout)?.[1] ?? '';
  assert.equal(get('bigdecimal'), '0.3e0,0.33333333333333333333e0,BigDecimal', `BigDecimal arithmetic:\n${out}`);
  assert.equal(get("racc"), "c,_racc_do_parse_c", `racc's parser runs on cparse:\n${out}`);
  assert.equal(get('nkf'), 'a4a2,EUC-JP', `NKF converts and guesses:\n${out}`);
  assert.equal(get('syslog'), 'true', `Syslog opens:\n${out}`);
  assert.equal(get('debug'), 'so', `debug's extension loads:\n${out}`);
  assert.equal(get('rbs'), 'Array[Integer]', `rbs parses a type through rbs_extension:\n${out}`);
  assert.equal(get('gems'), 'bigdecimal-3.1.8:built,racc-1.8.1:built,nkf-0.2.0:built,syslog-0.2.0:built,debug-1.11.0:built,rbs-3.8.0:built', `the bundled gems are installed with their extensions marked built:\n${out}`);
  assert.doesNotMatch(r.stderr, /Ignoring|not part of the default gems|extensions are not built/, `no RubyGems warning:\n${out}`);
  const list = await run(['gem', 'list', '--local'], { cwd: '/tmp' });
  assert.equal(list.status, 0, `gem list: ${list.stdout}${list.stderr}`);
  const listed = list.stdout.split('\n').filter((l) => /^(bigdecimal|racc|nkf|syslog|debug|rbs) /.test(l)).join('\n');
  assert.equal(listed, 'bigdecimal (3.1.8)\ndebug (1.11.0)\nnkf (0.2.0)\nracc (1.8.1)\nrbs (3.8.0)\nsyslog (0.2.0)', `gem list: ${list.stdout}${list.stderr}`);
  console.log(`bundled gems: ${r.stdout.trim().replace(/\n/g, ' | ')}`);
}
