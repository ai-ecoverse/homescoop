/**
 * wasix-autoconf (homescoop#470): autoconf, and automake's aclocal through
 * autom4te, on wasix-perl + wasix-m4 alone, and the configure they write.
 *
 * - A PATH with every command of the realm but grep, sed and awk (links in
 *   /tmp/bare): aclocal, autoconf and automake --add-missing write configure
 *   and Makefile.in. Until 2.72.0-6, autom4te's GNU m4 probe piped
 *   `m4 --help` into grep, so this died with "need GNU m4 1.4 or later: m4".
 *   The generated configure itself needs sed (the README says so).
 * - The probe still refuses an m4 that isn't GNU m4.
 * - With grep, sed and gawk: sh ./configure writes a Makefile with VERSION = 1.0.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = async (script, opts = {}) => {
    const r = await run(['bash', '-c', script], { cwd: '/home/p', ...opts });
    return { ...r, all: `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}` };
  };
  await write('home/p/configure.ac', 'AC_INIT([hello],[1.0])\nAM_INIT_AUTOMAKE([foreign])\nAC_CONFIG_FILES([Makefile])\nAC_OUTPUT\n');
  await write('home/p/Makefile.am', 'bin_SCRIPTS =\n');

  const bare = await sh('mkdir -p /tmp/bare && cd /usr/bin && for t in *; do case $t in *grep|sed|*awk) continue;; esac; ln -sf "/usr/bin/$t" "/tmp/bare/$t"; done; ls /tmp/bare | wc -l', { cwd: '/tmp' });
  assert.equal(bare.status, 0, bare.all);
  const none = await sh('PATH=/tmp/bare; for t in grep sed awk gawk; do command -v $t || echo "no $t"; done');
  assert.equal(none.stdout, 'no grep\nno sed\nno awk\nno gawk\n', `the bare PATH has grep, sed or awk: ${none.all}`);

  const probe = await sh('PATH=/tmp/bare autom4te --version');
  assert.equal(probe.status, 0, `autom4te --version without grep: ${probe.all}`);
  assert.match(probe.stdout, /^autom4te \(GNU Autoconf\) 2\.72\n/, probe.all);
  assert.doesNotMatch(probe.stderr, /need GNU m4|grep/, probe.all);

  const gen = await sh('PATH=/tmp/bare; aclocal && autoconf && automake --add-missing && test -s configure && test -s Makefile.in && test -s aclocal.m4 && echo generated');
  assert.equal(gen.status, 0, `aclocal && autoconf && automake --add-missing without grep, sed or awk: ${gen.all}`);
  assert.match(gen.stdout, /generated\n$/, gen.all);
  assert.doesNotMatch(gen.stderr, /error/, gen.all);

  const noSed = await sh('PATH=/tmp/bare sh ./configure');
  assert.notEqual(noSed.status, 0, `configure without sed should fail: ${noSed.all}`);
  assert.match(noSed.stderr, /sed: command not found/, noSed.all);

  const notGnu = await sh('PATH=/tmp/bare M4=/usr/bin/true autoconf -f');
  assert.notEqual(notGnu.status, 0, `autoconf with M4=/usr/bin/true: ${notGnu.all}`);
  assert.match(notGnu.stderr, /autom4te: error: need GNU m4 1\.4 or later: \/usr\/bin\/true/, notGnu.all);

  const conf = await sh('rm -f config.status Makefile && sh ./configure && grep "^VERSION = " Makefile && test -x config.status');
  assert.equal(conf.status, 0, `sh ./configure with grep, sed and gawk: ${conf.all}`);
  assert.match(conf.stdout, /config\.status: creating Makefile\n/, conf.all);
  assert.match(conf.stdout, /\nVERSION = 1\.0\n$/, conf.all);
  console.log('autoconf: aclocal/autoconf/automake --add-missing with no grep, sed or awk on PATH; configure then needs sed; M4=/usr/bin/true refused; configure with grep/sed/gawk writes VERSION = 1.0');
}
