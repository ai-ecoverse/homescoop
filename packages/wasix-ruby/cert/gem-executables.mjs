const TOOLS = [
  ['rdbg', 'debug', /^rdbg 1\.11\.0$/m],
  ['rbs', 'rbs', /^rbs 3\.8\.0$/m],
  ['racc', 'racc', /^racc version 1\.8\.1$/m],
  ['typeprof', 'typeprof', /^typeprof 0\.30\.1$/m],
  ['rdoc', 'rdoc', /^6\.14\.0$/m],
  ['ri', 'rdoc', /^ri 6\.14\.0$/m],
  ['syntax_suggest', 'syntax_suggest', /^syntax_suggest 2\.0\.3$/m],
  ['bundler', 'bundler', /^Bundler version 2\.6\.9$/m],
];

const GRAMMAR = `class Calc
  prechigh
    left '*'
    left '+'
  preclow
rule
  exp: exp '+' exp { result = val[0] + val[2] }
     | exp '*' exp { result = val[0] * val[2] }
     | NUM
end
---- inner
  def parse(s)
    @q = s.scan(/\\d+|[+*]/).map { |t| t =~ /\\d/ ? [:NUM, t.to_i] : [t, t] } + [[false, false]]
    do_parse
  end
  def next_token = @q.shift
`;

const BROKEN = `def broken
  if true
    puts "x"
end
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = (script) => run(['bash', '-lc', script], { cwd: '/tmp' });
  const lines = [];
  for (const [cmd, gem, want] of TOOLS) {
    const r = await sh(`${cmd} --version`);
    const out = `${cmd} --version: rc=${r.status} ${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `${cmd} (from the ${gem} gem) runs by name from bash (homescoop#1390): ${out}`);
    assert.match(r.stdout, want, `${cmd} --version names ${gem}'s version: ${out}`);
    lines.push(`${cmd}=${r.stdout.trim().split('\n').pop()}`);
  }
  await write('/tmp/gx/calc.y', GRAMMAR);
  const racc = await sh(`cd /tmp/gx && racc -o calc.rb calc.y && ruby -r./calc -e 'print Calc.new.parse("2+3*4")'`);
  assert.equal(racc.status, 0, `racc compiles a grammar that ruby runs: rc=${racc.status} ${racc.stdout}${racc.stderr}`);
  assert.equal(racc.stdout, '14', `racc's parser gives 2+3*4 = 14: ${racc.stdout}${racc.stderr}`);
  await write('/tmp/gx/broken.rb', BROKEN);
  const ss = await sh(`cd /tmp/gx && syntax_suggest broken.rb; echo "rc=$?"`);
  assert.match(ss.stdout, /Unmatched `end', missing keyword|Unmatched keyword, missing `end'/, `syntax_suggest names the missing end: ${ss.stdout}${ss.stderr}`);
  assert.match(ss.stdout, /if true/, `syntax_suggest shows the unclosed if: ${ss.stdout}${ss.stderr}`);
  const rbs = await sh(`cd /tmp/gx && printf 'class Foo\\n  def bar: (Integer) -> String\\nend\\n' > foo.rbs && rbs -I . validate --silent && echo rbs-ok`);
  assert.equal(rbs.status, 0, `rbs validates a signature file: rc=${rbs.status} ${rbs.stdout}${rbs.stderr}`);
  assert.match(rbs.stdout, /rbs-ok/, `rbs validate: ${rbs.stdout}${rbs.stderr}`);
  console.log(`gem executables: ${lines.join(' | ')}; racc 2+3*4=${racc.stdout}; syntax_suggest and rbs validate ok`);
}
