/**
 * patch checklist (#123): --dry-run, -p1 apply, an already-applied patch
 * (--forward: skipped, .rej, rc 1), -R reverse, a failed hunk (.rej + .orig,
 * rc 1), -b backup, a missing patch file (rc 2); and the package itself
 * ships the GNU GPL v3 as LICENSE plus THIRD-PARTY-NOTICES.md (2.8.0 shipped
 * homescoop's Apache text).
 */
const PATCH = `--- a/src/f.txt
+++ b/src/f.txt
@@ -1,3 +1,4 @@
 one
-two
+TWO
 three
+four
`;

export default async function (ctx) {
  const { run, assert, npmName } = ctx;
  const cwd = '/home/patch';
  const sh = (script) => run(['bash', '-c', script], { cwd });
  const mk = await run(['mkdir', '-p', `${cwd}/work/src`], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  const w = await run(['bash', '-c', 'cat > fix.patch'], { cwd, stdin: PATCH });
  assert.equal(w.status, 0);
  const exp = async (script, status, stdout, stderr = '') => {
    const r = await sh(script);
    assert.equal(r.status, status, `${script}: rc=${r.status} stderr=${r.stderr}`);
    assert.equal(r.stdout, stdout, `${script}: stdout`);
    assert.equal(r.stderr, stderr, `${script}: stderr`);
  };
  const ORIG = 'one\ntwo\nthree\n';
  const NEW = 'one\nTWO\nthree\nfour\n';
  const reset = 'cd work && rm -f src/f.txt.rej src/f.txt.orig && printf "one\\ntwo\\nthree\\n" > src/f.txt';

  await exp('patch --version | head -1', 0, 'GNU patch 2.8\n');
  await exp(`${reset} && patch -p1 --dry-run < ../fix.patch && cat src/f.txt`, 0, `checking file src/f.txt\n${ORIG}`);
  await exp(`${reset} && patch -p1 < ../fix.patch && cat src/f.txt`, 0, `patching file src/f.txt\n${NEW}`);
  await exp('cd work && patch -p1 --forward < ../fix.patch', 1,
    'patching file src/f.txt\nReversed (or previously applied) patch detected!  Skipping patch.\n1 out of 1 hunk ignored -- saving rejects to file src/f.txt.rej\n');
  await exp('cd work && rm -f src/f.txt.rej && patch -p1 -R < ../fix.patch && cat src/f.txt', 0, `patching file src/f.txt\n${ORIG}`);
  await exp('cd work && rm -f src/f.txt.rej src/f.txt.orig && printf "one\\nzwei\\nthree\\n" > src/f.txt && patch -p1 < ../fix.patch; s=$?; ls src; cat src/f.txt.rej; exit $s', 1,
    `patching file src/f.txt\nHunk #1 FAILED at 1.\n1 out of 1 hunk FAILED -- saving rejects to file src/f.txt.rej\nf.txt\nf.txt.orig\nf.txt.rej\n${PATCH.replace('--- a/src/f.txt\n+++ b/src/f.txt', '--- src/f.txt\n+++ src/f.txt')}`);
  await exp(`${reset} && patch -b -p1 < ../fix.patch && ls src && cat src/f.txt.orig`, 0, `patching file src/f.txt\nf.txt\nf.txt.orig\n${ORIG}`);
  await exp('cd work && patch -p1 -i nope.patch', 2, '', "patch: **** Can't open patch file nope.patch : No such file or directory\n");

  // The package's own licence files.
  const pkg = `/node_modules/${npmName}`;
  const lic = await sh(`head -2 ${pkg}/LICENSE`);
  assert.equal(lic.status, 0, `LICENSE: ${lic.stderr}`);
  assert.match(lic.stdout, /GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/, `LICENSE is not GPL-3: ${JSON.stringify(lic.stdout)}`);
  const notices = await sh(`head -1 ${pkg}/THIRD-PARTY-NOTICES.md`);
  assert.equal(notices.stdout, '# Third-party notices\n', `THIRD-PARTY-NOTICES.md: ${notices.stderr}`);
}
