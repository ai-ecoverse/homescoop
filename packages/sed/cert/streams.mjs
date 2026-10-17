/**
 * sed beyond -i and e (#683): big streams through the glue's gathered
 * writev, pipelines, -i.bak with -E and w, -z, symlinks, modes kept by -i,
 * a non-root user on /etc/passwd, and the error exit statuses.
 * Needs wasm-coreutils (seq, ln, chmod, stat, od, sha256sum).
 */
const N = 200000;

export default async function (ctx) {
  const { run, read, assert, addUser } = ctx;
  const sh = async (script, opts = {}) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp/sd', ...opts });
    assert.equal(r.status, 0, `${opts.user ?? 'root'}: ${script}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout;
  };
  await run(['bash', '-c', 'rm -rf /tmp/sd && mkdir -p /tmp/sd && chmod 755 /tmp/sd'], { cwd: '/tmp' });

  // A 200,000-line stream (1.3 MB), to stdout and to a file.
  await sh(`seq ${N} > big`);
  const want = Array.from({ length: N }, (_, i) => `${String(i + 1).replace(/1/g, 'one')}\n`).join('');
  const out = await run(['sed', 's/1/one/g', 'big'], { cwd: '/tmp/sd' });
  assert.equal(out.status, 0, `sed big: ${out.stderr}`);
  assert.equal(out.stdout.length, want.length, 'sed s/1/one/g big: stdout length');
  assert.ok(out.stdout === want, 'sed s/1/one/g big: stdout bytes');
  await sh('sed s/1/one/g big > big.out');
  assert.ok((await read('tmp/sd/big.out')) === want, 'sed s/1/one/g big > file: bytes');

  // Pipelines: sed into sed.
  assert.equal(await sh("sed -n 's/5$/x/p' big | sed -n '$='"), `${N / 10}\n`, 'sed -n s///p | sed -n $=');
  assert.equal(await sh("seq 10 | sed -n '3,5p;8q'"), '3\n4\n5\n', "seq 10 | sed -n '3,5p;8q'");

  // -i.bak with -E and w.
  await sh('seq 10 30 > n.txt');
  await sh("sed -i.bak -E -e 's/^([0-9])0$/\\1Z/' -e '/Z/w xs' n.txt");
  assert.equal(await read('tmp/sd/n.txt'), [...Array(21).keys()].map((i) => (i % 10 ? `${i + 10}` : `${(i + 10) / 10}Z`)).join('\n') + '\n', 'sed -i.bak -E: n.txt');
  assert.equal(await read('tmp/sd/n.txt.bak'), [...Array(21).keys()].map((i) => `${i + 10}`).join('\n') + '\n', 'sed -i.bak: n.txt.bak is the original');
  assert.equal(await read('tmp/sd/xs'), '1Z\n2Z\n3Z\n', 'sed w xs');

  // -z: NUL-separated records.
  assert.equal(await sh("printf 'a\\0b\\0' | sed -z s/b/B/ | od -An -c | tr -s ' '"), ' a \\0 B \\0\n', 'sed -z');

  // -i keeps the mode; symlinks: --follow-symlinks edits the target, plain -i replaces the link.
  assert.equal(await sh('printf "x\\n" > m.txt && chmod 640 m.txt && sed -i s/x/y/ m.txt && stat -c %a m.txt && cat m.txt'), '640\ny\n', 'sed -i keeps 0640');
  assert.equal(await sh([
    'printf "x\\n" > t1 && ln -s t1 l1 && sed -i --follow-symlinks s/x/F/ l1',
    'stat -c %F l1 && cat t1',
    'printf "x\\n" > t2 && ln -s t2 l2 && sed -i s/x/P/ l2',
    'stat -c %F l2 && cat t2 l2',
  ].join(' && ')), 'symbolic link\nF\nregular file\nx\nP\n', 'sed -i --follow-symlinks vs -i on a symlink');

  // users: cone can't edit /etc/passwd; its own file stays its own.
  await addUser({ name: 'cone' });
  const before = await sh('sha256sum /etc/passwd; stat -c "%a %u:%g" /etc/passwd /etc');
  const pw = await run(['sed', '-i', 's/^root:/toor:/', '/etc/passwd'], { cwd: '/tmp', user: 'cone' });
  assert.equal(pw.status, 4, `cone: sed -i /etc/passwd: rc=${pw.status} stderr=${pw.stderr}`);
  assert.match(pw.stderr, /^sed: couldn't open temporary file \/etc\/sed\w+: Permission denied\n$/, 'cone: sed -i /etc/passwd stderr');
  assert.equal(await sh('sha256sum /etc/passwd; stat -c "%a %u:%g" /etc/passwd /etc'), before, 'cone: /etc/passwd unchanged');
  await sh('mkdir /tmp/sd/cone && chown 1000:1000 /tmp/sd/cone');
  assert.equal(await sh('cd /tmp/sd/cone && printf "x\\n" > c.txt && chmod 600 c.txt && sed -i s/x/c/ c.txt && stat -c "%a %u:%g" c.txt && cat c.txt', { user: 'cone' }), '600 1000:1000\nc\n', "cone: sed -i on its own 0600 file keeps owner and mode");
  const peek = await run(['sed', '-n', '1p', '/tmp/sd/cone/c.txt'], { cwd: '/tmp' });
  assert.equal(peek.stdout, 'c\n', "root reads cone's file");
  await sh('printf "s\\n" > /tmp/sd/root600 && chmod 600 /tmp/sd/root600');
  const r600 = await run(['sed', 'p', '/tmp/sd/root600'], { cwd: '/tmp', user: 'cone' });
  assert.equal(r600.status, 2, `cone: sed p root's 0600: rc=${r600.status}`);
  assert.equal(r600.stderr, "sed: can't read /tmp/sd/root600: Permission denied\n", "cone: sed p root's 0600 stderr");

  // Exit statuses: 1 for a bad script, 2 for a missing input.
  const bad = await run(['sed', 's/a/'], { cwd: '/tmp', stdin: 'a\n' });
  assert.equal(bad.status, 1, `sed s/a/: rc=${bad.status}`);
  assert.equal(bad.stderr, "sed: -e expression #1, char 4: unterminated 's' command\n", 'sed s/a/ stderr');
  const missing = await run(['sed', 'p', '/nonexistent'], { cwd: '/tmp' });
  assert.equal(missing.status, 2, `sed p /nonexistent: rc=${missing.status}`);
  assert.equal(missing.stderr, "sed: can't read /nonexistent: No such file or directory\n");
  console.log(`streams: ${N}-line stream bytes match (stdout and file), pipelines, -i.bak -E w, -z, modes, symlinks, users, exit statuses`);
}
