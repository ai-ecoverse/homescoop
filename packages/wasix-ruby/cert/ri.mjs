export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = (script) => run(['bash', '-lc', script], { cwd: '/tmp' });
  const dirs = await sh('ri --list-doc-dirs');
  const dirsOut = `ri --list-doc-dirs: rc=${dirs.status} ${dirs.stdout}${dirs.stderr}`;
  assert.equal(dirs.status, 0, dirsOut);
  const system = dirs.stdout.split('\n').map((l) => l.trim()).find((l) => l.endsWith('/share/ri/3.4.0/system'));
  assert.ok(system && system.includes('@ai-ecoverse/wasix-ruby/'), `ri's system directory is the package's share/ri/3.4.0/system: ${dirsOut}`);
  const there = await sh(`ls -A '${system}'; test -s '${system}/ri.pack' && echo present`);
  assert.match(there.stdout, /present/, `the package ships ri data in ${system} (homescoop#1622): ${there.stdout}${there.stderr}`);
  assert.deepEqual(there.stdout.trim().split('\n'), ['ri.pack', 'present'], `the ri data is one file, ri.pack: ${there.stdout}${there.stderr}`);
  const rows = [
    ['String#upcase', /^= String#upcase$/m, /upcased characters/],
    ['Integer#digits', /^= Integer#digits$/m, /digits/],
    ['JSON.parse', /^= JSON\.parse$/m, /Returns the Ruby objects created by parsing/],
    ['Gem::Specification', /^= Gem::Specification < Gem::BasicSpecification$/m, /gemspec|specification/i],
  ];
  const seen = [];
  for (const [name, head, body] of rows) {
    const r = await sh(`ri -T -f rdoc '${name}'`);
    const out = `ri ${name}: rc=${r.status} ${r.stdout}${r.stderr}`;
    assert.doesNotMatch(r.stdout + r.stderr, /Nothing known about/, `ri has documentation for ${name} (homescoop#1622): ${out}`);
    assert.equal(r.status, 0, out);
    assert.match(r.stdout, head, `ri ${name} prints its heading: ${out}`);
    assert.match(r.stdout, body, `ri ${name} prints its documentation: ${out}`);
    seen.push(name);
  }
  const page = await sh(`ri -T -f rdoc 'ruby:README.md'`);
  const pageOut = `ri ruby:README.md: rc=${page.status} ${page.stdout.slice(0, 400)}${page.stderr}`;
  assert.equal(page.status, 0, pageOut);
  assert.match(page.stdout, /What is Ruby\?/, `ri reads a root page (README.md) from ri.pack: ${pageOut}`);
  seen.push('ruby:README.md');
  const corrupt = await sh(`ruby -e '
    real = File.binread(ARGV[0])
    huge = Marshal.dump({"cache.ri" => [0, 1 << 40], "String/upcase-i.ri" => [0, 10]})
    spill = Marshal.dump({"cache.ri" => [0, 64], "String/upcase-i.ri" => [real.bytesize, 10]})
    { "truncated" => real.byteslice(0, 5000), "huge-index" => [1 << 62].pack("Q>") + "x" * 32,
      "huge-entry" => [huge.bytesize].pack("Q>") + huge + "x" * 64, "past-end" => [spill.bytesize].pack("Q>") + spill + "x" * 64 }.each do |n, b|
      Dir.mkdir("/tmp/badri-#{n}") unless Dir.exist?("/tmp/badri-#{n}")
      File.binwrite("/tmp/badri-#{n}/ri.pack", b)
    end' '${system}/ri.pack' && for n in truncated huge-index huge-entry past-end; do ri --no-standard-docs -d /tmp/badri-$n -T String 2>&1; echo "$n rc=$?"; done`);
  const cOut = `corrupt packs: rc=${corrupt.status} ${corrupt.stdout}${corrupt.stderr}`;
  for (const n of ['truncated', 'huge-index', 'huge-entry', 'past-end']) {
    assert.match(corrupt.stdout, new RegExp(`Nothing known about String\\n${n} rc=1`), `a ${n} ri.pack is refused and ri reports nothing known, without reading outside the pack: ${cOut}`);
  }
  assert.doesNotMatch(corrupt.stdout + corrupt.stderr, /NoMemoryError|RangeError|ArgumentError|TypeError|Error\)/, `a corrupt ri.pack raises nothing: ${cOut}`);
  const list = await sh('ri --list');
  const names = list.stdout.split('\n');
  for (const n of ['String', 'Integer', 'JSON', 'Gem::Specification', 'OpenSSL::Digest', 'Bundler']) {
    assert.ok(names.includes(n), `ri --list names ${n}: rc=${list.status} ${names.length} lines ${list.stderr}`);
  }
  assert.ok(names.length > 1000, `ri --list names core and stdlib (${names.length} lines)`);
  const miss = await sh(`ri -T NoSuchThingHere; echo "rc=$?"`);
  assert.match(miss.stdout + miss.stderr, /Nothing known about NoSuchThingHere/, `an unknown name is still reported: ${miss.stdout}${miss.stderr}`);
  assert.match(miss.stdout, /rc=1/, `an unknown name exits 1: ${miss.stdout}${miss.stderr}`);
  console.log(`ri: system ${system}; ${seen.join(', ')} documented; --list ${names.length} lines; unknown name rc 1; 4 corrupt packs refused`);
}
