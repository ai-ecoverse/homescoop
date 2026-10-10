/**
 * wasix-perl regex engine (static build: ext/re linked next to the core
 * engine). ext/re is compiled with PERL_EXT_RE_BUILD/DEBUG and must keep
 * its own helpers (re_top.h renames); a mixed engine shows up in re debug
 * traces, re 'eval', named captures, \K and regex-heavy core modules.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/perl-regex';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const perl = async (args, opts = {}) => {
    const r = await run(['perl', ...args], { cwd, ...opts });
    assert.equal(r.status, 0, `perl ${args.join(' ')}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r;
  };

  // use re 'debug': the compile and exec trace on stderr.
  const dbg = await perl(['-Mre=debug', '-e', 'print "ab" =~ /a(b)/ ? "m=$1\\n" : "no\\n"']);
  assert.equal(dbg.stdout, 'm=b\n');
  assert.match(dbg.stderr, /^Compiling REx "a\(b\)"/m, dbg.stderr);
  assert.match(dbg.stderr, /^Final program:/m);
  assert.match(dbg.stderr, /^Matching REx "a\(b\)" against "ab"/m);
  assert.match(dbg.stderr, /^Match successful!/m);
  assert.match(dbg.stderr, /^Freeing REx: "a\(b\)"/m);

  // use re 'eval' with a code block in a runtime-interpolated pattern.
  assert.equal((await perl(['-e', 'use re "eval"; my $n = 0; my $c = q{(?{ $n++ })}; "aaa" =~ /^(?:a$c)*$/; print "$n\\n"'])).stdout, '3\n');

  // qr// with named captures, %+, \K, re::regname / regnames.
  assert.equal((await perl(['-e',
    'my $q = qr/(?<y>\\d{4})-(?<m>\\d\\d)/; "on 2026-10 ok" =~ $q or die; print "$+{y} $+{m} ", re::regname("y"), " ", join(",", sort(re::regnames())), "\\n";'
  ])).stdout, '2026 10 2026 m,y\n');
  assert.equal((await perl(['-e', '(my $s = "foo=bar") =~ s/foo=\\Kbar/baz/; print "$s\\n"'])).stdout, 'foo=baz\n');
  assert.equal((await perl(['-e', 'print join("|", split /(?<=,)/, "a,b,c"), "\\n"'])).stdout, 'a,|b,|c\n');
  assert.equal((await perl(['-e', 'my @m = ("x1y22z333" =~ /(\\d+)/g); print "@m\\n"'])).stdout, '1 22 333\n');
  // The same patterns under re debug (debug engine) and without (core).
  const both = 'my @r; for my $s ("abcabc","xyz","aXbXc") { push @r, join ":", $s =~ /(a)(?:b|X)(c?)/ ? ($1,$2) : "-" } print "@r\\n"';
  const plain = (await perl(['-e', both])).stdout;
  const debug = (await perl(['-Mre=debug', '-e', both])).stdout;
  assert.equal(plain, 'a:c - a:\n');
  assert.equal(debug, plain, 'debug engine and core engine disagree');

  // Regex-heavy core modules.
  assert.equal((await perl(['-MText::Balanced=extract_bracketed', '-e',
    'my ($x, $rest) = extract_bracketed("(a(b)c) tail", "()"); print "$x|$rest\\n"'])).stdout, '(a(b)c)| tail\n');
  const pod = await perl(['-MPod::Simple::Text', '-e',
    'my $o = ""; my $p = Pod::Simple::Text->new; $p->output_string(\\$o); $p->parse_string_document("=head1 NAME\\n\\nX<idx>B<bold> I<it> C<code> L<perlre/Modifiers>\\n\\n=cut\\n"); print $o'], {});
  assert.match(pod.stdout, /NAME/);
  assert.match(pod.stdout, /bold it "code"/);
  assert.match(pod.stdout, /"Modifiers" in perlre/);
}
