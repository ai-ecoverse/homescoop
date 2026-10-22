const FROB = `# Frob things.
class Frob
  # Twiddles the frob.
  def twiddle; end
end
`;

const SPEC = `Gem::Specification.new do |s|
  s.name = "frob"
  s.version = "0.1"
  s.summary = "f"
  s.authors = ["a"]
  s.files = ["lib/frob.rb"]
end
`;

export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  await write('/tmp/gemri-src/frob.rb', FROB);
  await write('/tmp/gemri-src/frob.gemspec', SPEC);
  const seen = [];
  for (const user of [undefined, 'cone']) {
    if (user) await addUser({ name: user });
    const who = user ?? 'root';
    const cwd = user ? `/home/${user}` : '/tmp';
    const as = (script) => run(['bash', '-lc', script], { cwd, ...(user && { user }) });
    const build = await as('rm -rf gemri && mkdir -p gemri/lib && cp /tmp/gemri-src/frob.rb gemri/lib/ && cp /tmp/gemri-src/frob.gemspec gemri/ && cd gemri && gem build frob.gemspec 2>&1 && ls frob-0.1.gem');
    assert.equal(build.status, 0, `${who}: gem build: ${build.stdout}${build.stderr}`);
    const inst = await as('cd gemri && gem install --local --document ri frob-0.1.gem 2>&1');
    const instOut = `${who}: gem install --local --document ri: rc=${inst.status} ${inst.stdout}${inst.stderr}`;
    assert.equal(inst.status, 0, instOut);
    assert.match(inst.stdout, /^Successfully installed frob-0\.1$/m, instOut);
    assert.match(inst.stdout, /^Installing ri documentation for frob-0\.1$/m, `${who}: gem install --document ri generates the gem's ri data (homescoop#1675): ${instOut}`);
    const tree = await as('d="$(gem env gemdir)/doc/frob-0.1/ri"; echo "dir=$d"; test -d "$d" && echo tree && ls "$d" && ls "$d/Frob"');
    const treeOut = `${who}: the gem's ri tree: rc=${tree.status} ${tree.stdout}${tree.stderr}`;
    assert.match(tree.stdout, /^tree$/m, `${who}: gem install --document ri writes $(gem env gemdir)/doc/frob-0.1/ri (homescoop#1675): ${treeOut}`);
    assert.match(tree.stdout, /^cache\.ri$/m, treeOut);
    assert.match(tree.stdout, /^twiddle-i\.ri$/m, treeOut);
    assert.doesNotMatch(tree.stdout, /^ri\.pack$/m, `${who}: a gem's ri data is a plain on-disk tree, not a pack: ${treeOut}`);
    const meth = await as('ri -T -f rdoc Frob#twiddle 2>&1; echo "rc=$?"');
    const methOut = `${who}: ri Frob#twiddle: ${meth.stdout}${meth.stderr}`;
    assert.doesNotMatch(meth.stdout, /Nothing known about/, `${who}: ri reads the installed gem's ri data (homescoop#1675): ${methOut}`);
    assert.match(meth.stdout, /^= Frob#twiddle$/m, methOut);
    assert.match(meth.stdout, /Twiddles the frob\./, methOut);
    assert.match(meth.stdout, /^rc=0$/m, methOut);
    const both = await as('ri -T -f rdoc Frob String#upcase 2>&1; echo "rc=$?"');
    const bothOut = `${who}: ri Frob String#upcase: ${both.stdout}${both.stderr}`;
    assert.match(both.stdout, /Frob things\./, `${who}: ri reads a class from the gem's tree: ${bothOut}`);
    assert.match(both.stdout, /upcased characters/, `${who}: the same ri still reads String#upcase from the system ri.pack: ${bothOut}`);
    assert.match(both.stdout, /^rc=0$/m, bothOut);
    const none = await as('cd gemri && gem uninstall -x frob 2>&1 && d="$(gem env gemdir)/doc/frob-0.1" && rm -rf "$d" && gem install --local --no-document frob-0.1.gem 2>&1 && { test -e "$d" && echo "doc written" || echo "no doc"; }; ri -T Frob#twiddle 2>&1; echo "rc=$?"');
    const noneOut = `${who}: gem install --no-document: ${none.stdout}${none.stderr}`;
    assert.match(none.stdout, /^Successfully installed frob-0\.1$/m, noneOut);
    assert.match(none.stdout, /^no doc$/m, `${who}: gem install --no-document writes no ri data: ${noneOut}`);
    assert.doesNotMatch(none.stdout, /Installing ri documentation/, noneOut);
    assert.match(none.stdout, /Nothing known about Frob/, noneOut);
    assert.match(none.stdout, /^rc=1$/m, noneOut);
    const plain = await as('cd gemri && gem uninstall -x frob 2>&1 && gem install --local frob-0.1.gem 2>&1 && test -s "$(gem env gemdir)/doc/frob-0.1/ri/Frob/twiddle-i.ri" && echo "doc written"');
    const plainOut = `${who}: gem install without --document: rc=${plain.status} ${plain.stdout}${plain.stderr}`;
    assert.match(plain.stdout, /^Installing ri documentation for frob-0\.1$/m, `${who}: gem install writes ri data by default, as RubyGems does: ${plainOut}`);
    assert.match(plain.stdout, /^doc written$/m, plainOut);
    const clean = await as('gem uninstall -x frob 2>&1 && rm -rf "$(gem env gemdir)/doc/frob-0.1" gemri');
    assert.equal(clean.status, 0, `${who}: gem uninstall: ${clean.stdout}${clean.stderr}`);
    seen.push(who);
  }
  console.log(`gem-ri: gem install --document ri writes doc/frob-0.1/ri and ri reads it beside the system ri.pack; --no-document writes none; a plain gem install writes ri; as ${seen.join(' and ')}`);
}
