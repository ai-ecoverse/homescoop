/**
 * wasix-perl checklist: version, core XS modules (static), fork through
 * asyncify, file I/O and a pipe to a child process.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/perl-cert';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const perl = async (code, opts = {}) => {
    const r = await run(['perl', '-e', code], { cwd, ...opts });
    assert.equal(r.status, 0, `perl -e ${code}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout;
  };

  assert.equal(await perl('print "$^V\\n"'), 'v5.42.0\n');
  assert.equal(await perl('use List::Util qw(sum max); use POSIX qw(floor); print sum(1..4), " ", max(3,9,2), " ", floor(2.7), "\\n"'), '10 9 2\n');
  assert.equal(await perl('use Digest::SHA qw(sha256_hex); use MIME::Base64; print sha256_hex("abc"), " ", encode_base64("hi", ""), "\\n"'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad aGk=\n');
  assert.equal(await perl('my $p = fork; if (!$p) { print "child\\n"; exit 3 } waitpid($p, 0); print "parent ", $? >> 8, "\\n"'), 'child\nparent 3\n');
  assert.equal(await perl('open my $f, ">", "t.txt" or die; print $f "one\\ntwo\\n"; close $f; open $f, "<", "t.txt" or die; my @l = <$f>; print scalar(@l), "\\n"'), '2\n');
  assert.equal(await perl('open my $p, "-|", "echo", "piped" or die "$!"; print <$p>'), 'piped\n');
  const stdin = await run(['perl', '-ne', 'print uc'], { cwd, stdin: 'abc\n' });
  assert.equal(stdin.stdout, 'ABC\n');
  // @INC: the same layout as 5.42.0-6 (flat lib/perl5, archlib under it).
  const inc = (await perl('print join("\\n", @INC), "\\n"')).trim().split('\n');
  const P = '/node_modules/@ai-ecoverse/wasix-perl/lib/perl5';
  assert.deepEqual(inc.slice(0, 6), [
    `${P}/wasm32-wasix`, P, `${P}/wasm32-wasix`, `${P}/site_perl`, `${P}/site_perl/wasm32-wasix`,
    '/usr/lib/perl5/site_perl/5.42.0/wasm32-wasix',
  ], inc.join('\n'));
  assert.ok(inc.includes('/usr/lib/perl5/site_perl/5.42.0'), 'site_perl in @INC');
  assert.equal(await perl('require List::Util; print $INC{"List/Util.pm"}, "\\n"'), `${P}/List/Util.pm\n`);
  assert.equal(await perl('use Config; print "$Config{installsitelib}\\n"'), '/usr/lib/perl5/site_perl/5.42.0\n');
  // A pure-Perl module installed into the site dir loads from there.
  const site = await run(['bash', '-c', 'mkdir -p /usr/lib/perl5/site_perl/5.42.0/HSCert && printf "package HSCert::Site; sub hi { \\"site ok\\" } 1;\\n" > /usr/lib/perl5/site_perl/5.42.0/HSCert/Site.pm && perl -MHSCert::Site -e \'print HSCert::Site::hi(), " ", $INC{"HSCert/Site.pm"}, "\\n"\''], { cwd });
  assert.equal(site.stdout, 'site ok /usr/lib/perl5/site_perl/5.42.0/HSCert/Site.pm\n', `site install stderr=${site.stderr}`);
  // PERL5LIB from the caller is prepended.
  const p5 = await run(['bash', '-c', 'mkdir -p /home/p5lib/HSCert && printf "package HSCert::Lib; 1;\\n" > /home/p5lib/HSCert/Lib.pm && PERL5LIB=/home/p5lib perl -MHSCert::Lib -e \'print $INC{"HSCert/Lib.pm"}, "\\n"\''], { cwd });
  assert.equal(p5.stdout, '/home/p5lib/HSCert/Lib.pm\n', `PERL5LIB stderr=${p5.stderr}`);

  const die = await run(['perl', '-e', 'die "boom\\n"'], { cwd });
  assert.notEqual(die.status, 0);
  assert.match(die.stderr, /^boom$/m);
}
