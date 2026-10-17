/**
 * qpdf under users enforce (#723). 12.4.2-2's qpdf, fix-qdf and zlib-flate
 * link the slicc credentials (slicc_cred_js), so their files are opened as
 * the caller and their outputs carry the caller's ids.
 *
 * bob's home is 0755 with his e.pdf 0600 and root's pub.pdf 0644; alice's
 * home is 0700.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const setup = await run(['bash', '-c', [
    'cd /home/bob && qpdf --empty --qdf e.pdf && cp e.pdf pub.pdf && chmod 644 pub.pdf',
    `chown ${bob.uid}:${bob.gid} e.pdf && chmod 600 e.pdf && chmod 755 /home/bob && chmod 700 /home/alice`,
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stderr}`);
  const as = (argv, user) => run(argv, { cwd: user ? `/home/${user}` : '/root', ...(user && { user }) });
  const ok = (r, what) => assert.equal(r.status, 0, `${what}: rc=${r.status} stderr=${r.stderr}`);
  const denied = (r, what, msg) => {
    assert.equal(r.status, 2, `${what}: rc=${r.status} stdout=${r.stdout}`);
    assert.equal(r.stdout, '', `${what}: no stdout`);
    assert.equal(r.stderr, `${msg}: Permission denied\n`, `${what}: stderr`);
  };

  // root reads bob's 0600 file with every tool.
  let r = await as(['qpdf', '--show-npages', '/home/bob/e.pdf']);
  ok(r, 'root: qpdf --show-npages bob\'s e.pdf');
  assert.equal(r.stdout, '0\n');
  r = await as(['fix-qdf', '/home/bob/e.pdf']);
  ok(r, 'root: fix-qdf bob\'s e.pdf');
  assert.match(r.stdout, /^%PDF-1\.3\n[^]*%QDF-1\.0/, 'root: fix-qdf output');
  r = await as(['bash', '-c', 'zlib-flate -compress < /home/bob/e.pdf | zlib-flate -uncompress | sha256sum; sha256sum < /home/bob/e.pdf']);
  ok(r, 'root: zlib-flate round trip of bob\'s e.pdf');
  const [x, y] = r.stdout.trim().split('\n');
  assert.equal(x, y, 'root: zlib-flate round trip of bob\'s e.pdf is byte-identical');

  // alice is refused bob's 0600 file and bob's directory.
  denied(await as(['qpdf', '--check', '/home/bob/e.pdf'], 'alice'), 'alice: qpdf --check bob\'s 0600', 'qpdf: open /home/bob/e.pdf');
  denied(await as(['qpdf', '/home/bob/e.pdf', 'x.pdf'], 'alice'), 'alice: qpdf bob\'s 0600 → x.pdf', 'qpdf: open /home/bob/e.pdf');
  denied(await as(['fix-qdf', '/home/bob/e.pdf'], 'alice'), 'alice: fix-qdf bob\'s 0600', 'fix-qdf: error: open /home/bob/e.pdf');
  denied(await as(['qpdf', '--empty', '/home/bob/new.pdf'], 'alice'), 'alice: qpdf --empty into bob\'s 0755 home', 'qpdf: open /home/bob/new.pdf');
  denied(await as(['qpdf', '--replace-input', '/home/bob/pub.pdf'], 'alice'), 'alice: --replace-input in bob\'s home', 'qpdf: open /home/bob/pub.pdf.~qpdf-temp#');
  r = await as(['bash', '-c', 'ls /home/bob; sha256sum < /home/bob/pub.pdf; sha256sum < /home/bob/e.pdf']);
  const [l1, l2, h1, h2] = r.stdout.trim().split('\n');
  assert.deepEqual([l1, l2, h1], ['e.pdf', 'pub.pdf', h2], 'alice left nothing in bob\'s home and pub.pdf is unchanged');

  // alice's own outputs are alice's, from a file she may read.
  r = await as(['bash', '-c', 'umask 022; qpdf /home/bob/pub.pdf mine.pdf && fix-qdf /home/bob/pub.pdf mine.qdf && zlib-flate -compress < mine.pdf > mine.z && stat -c "%u:%g %a %n" mine.pdf mine.qdf mine.z && qpdf --show-npages mine.pdf'], 'alice');
  ok(r, 'alice: qpdf / fix-qdf / zlib-flate into her home');
  const ids = `${alice.uid}:${alice.gid} 644`;
  assert.equal(r.stdout, `${ids} mine.pdf\n${ids} mine.qdf\n${ids} mine.z\n0\n`, "alice: her outputs are hers");
  r = await as(['qpdf', '--show-npages', '/home/alice/mine.qdf']);
  ok(r, "root: reads alice's mine.qdf");
  assert.equal(r.stdout, '0\n');
  console.log("users: alice's qpdf/fix-qdf are refused bob's 0600 file and his dir (rc 2, Permission denied); her outputs are hers; root reads both");
}
