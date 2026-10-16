/**
 * wasix-automake (homescoop#470, #426): aclocal and automake on the
 * wasix-autoconf this package pins, with no grep, sed or awk on PATH, and
 * the configure they write with them.
 *
 * The realm's wasix-autoconf is cert/meta.json's needsInstall pin; the spec
 * first checks that it is the version the tarball depends on, so the cert
 * runs what a user's install gets. 1.17.0-8 pinned 2.72.0-6, whose autom4te
 * piped m4 --help into grep: without grep, aclocal died with "need GNU m4
 * 1.4 or later: m4". It checks wasix-perl the same way, and that the
 * pinned wasix-autoconf takes the same perl (one perl in the tree, #656).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

function manifest(tgz) {
  const buf = gunzipSync(readFileSync(tgz));
  for (let at = 0; at + 512 <= buf.length; ) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === 'package/package.json') return JSON.parse(buf.subarray(at + 512, at + 512 + size).toString('utf8'));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`no package/package.json in ${tgz}`);
}

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sh = async (script, opts = {}) => {
    const r = await run(['bash', '-c', script], { cwd: '/home/p', ...opts });
    return { ...r, all: `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}` };
  };
  const pin = manifest(tarball()).dependencies?.['@ai-ecoverse/wasix-autoconf'];
  const ac = await sh('cat /node_modules/@ai-ecoverse/wasix-autoconf/package.json', { cwd: '/tmp' });
  assert.equal(ac.status, 0, ac.all);
  const realm = JSON.parse(ac.stdout).version;
  assert.equal(pin, realm, `the tarball pins wasix-autoconf ${pin}, the cert runs ${realm} (cert/meta.json needsInstall)`);

  // One perl in the tree (homescoop#634, #656): the tarball's wasix-perl pin
  // is the realm's wasix-perl and the one the pinned wasix-autoconf takes, so
  // npm installs a single @ai-ecoverse/wasix-perl. 1.17.0-9 pinned 5.42.0-11
  // next to wasix-autoconf 2.72.0-8's 5.42.0-13: two perls.
  const perlPin = manifest(tarball()).dependencies?.['@ai-ecoverse/wasix-perl'];
  assert.ok(perlPin, 'the tarball depends on @ai-ecoverse/wasix-perl');
  const acPerl = JSON.parse(ac.stdout).dependencies?.['@ai-ecoverse/wasix-perl'];
  assert.equal(perlPin, acPerl, `the tarball pins wasix-perl ${perlPin}, its wasix-autoconf ${realm} pins ${acPerl}: an install gets two perls`);
  const pl = await sh('cat /node_modules/@ai-ecoverse/wasix-perl/package.json', { cwd: '/tmp' });
  assert.equal(pl.status, 0, pl.all);
  const realmPerl = JSON.parse(pl.stdout).version;
  assert.equal(perlPin, realmPerl, `the tarball pins wasix-perl ${perlPin}, the cert runs ${realmPerl} (cert/meta.json needsInstall)`);

  await write('home/p/configure.ac', 'AC_INIT([hello],[1.0])\nAM_INIT_AUTOMAKE([foreign])\nAC_CONFIG_FILES([Makefile])\nAC_OUTPUT\n');
  await write('home/p/Makefile.am', 'bin_SCRIPTS =\n');
  const bare = await sh('mkdir -p /tmp/bare && cd /usr/bin && for t in *; do case $t in *grep|sed|*awk) continue;; esac; ln -sf "/usr/bin/$t" "/tmp/bare/$t"; done', { cwd: '/tmp' });
  assert.equal(bare.status, 0, bare.all);
  const none = await sh('PATH=/tmp/bare; for t in grep sed awk; do command -v $t || echo "no $t"; done');
  assert.equal(none.stdout, 'no grep\nno sed\nno awk\n', none.all);

  const v = await sh('PATH=/tmp/bare; automake --version | head -1; aclocal --version | head -1');
  assert.equal(v.stdout, 'automake (GNU automake) 1.17\naclocal (GNU automake) 1.17\n', v.all);
  const gen = await sh('PATH=/tmp/bare; aclocal && autoconf && automake --add-missing && test -s Makefile.in && test -x install-sh && test -x missing && echo generated');
  assert.equal(gen.status, 0, `aclocal && autoconf && automake --add-missing without grep, sed or awk: ${gen.all}`);
  assert.match(gen.stdout, /generated\n$/, gen.all);
  assert.match(gen.stderr, /installing '\.\/install-sh'/, gen.all);
  assert.doesNotMatch(gen.stderr, /error/, gen.all);
  assert.match(await sh('grep -c "^VERSION = @VERSION@" Makefile.in').then((r) => r.stdout), /^1\n$/, 'Makefile.in substitutes VERSION');

  const conf = await sh('sh ./configure && grep "^VERSION = " Makefile');
  assert.equal(conf.status, 0, `sh ./configure with grep, sed and gawk: ${conf.all}`);
  assert.match(conf.stdout, /\nVERSION = 1\.0\n$/, conf.all);
  console.log(`automake: 1.17 on wasix-autoconf ${realm} and wasix-perl ${realmPerl} (the pinned ones, one perl); aclocal/autoconf/automake --add-missing without grep, sed or awk; configure with them writes VERSION = 1.0`);
}
