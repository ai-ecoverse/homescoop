/**
 * tar checklist (#176 sweep): plain, -z/-j/-J/-a archives (magic bytes and a
 * round trip with contents compared), archives on a pipe, and the
 * compressor tar forks and execs: it runs as tar's direct child under a
 * real pid (it is in /proc; slicc-kernel#176), and its exit status reaches
 * tar ("Child returned status 3", rc 2). Errors: corrupt gzip, missing file.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/tar';
  const sh = (script) => run(['bash', '-c', script], { cwd });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  await ok('mkdir -p src/d && printf "alpha\\n" > src/a.txt && printf "beta\\n" > src/d/b.txt && printf "\\x00\\x01\\xff" > src/bin');

  const ver = await ok('tar --version');
  assert.match(ver.stdout, /^tar \(GNU tar\) 1\.35$/m);

  const LIST = './\n./a.txt\n./bin\n./d/\n./d/b.txt\n';
  const roundTrip = async (flag, file, magic) => {
    await ok(`tar -c${flag}f ${file} -C src .`);
    assert.equal((await ok(`tar -t${flag}f ${file} | sort`)).stdout, LIST, `list ${file}`);
    if (magic) {
      const od = (await ok(`od -An -tx1 -N${magic.split(' ').length} ${file}`)).stdout;
      assert.equal(od.trim().split(/\s+/).join(' '), magic, `magic ${file}`);
    }
    await ok(`rm -rf out && mkdir out && tar -x${flag}f ${file} -C out`);
    const sums = await ok('cd src && sha256sum a.txt d/b.txt bin; cd ../out && sha256sum a.txt d/b.txt bin');
    const [a, b] = [sums.stdout.split('\n').slice(0, 3), sums.stdout.split('\n').slice(3, 6)];
    assert.deepEqual(b, a, `extracted ${file} differs`);
  };
  await roundTrip('', 'x.tar');
  await roundTrip('z', 'x.tgz', '1f 8b');
  await roundTrip('j', 'x.tbz', '42 5a 68');
  await roundTrip('J', 'x.txz', 'fd 37 7a 58 5a 00');

  // -a picks the compressor from the suffix.
  assert.equal((await ok('tar -caf a.tar.xz -C src . && od -An -tx1 -N2 a.tar.xz')).stdout.trim(), 'fd 37');
  assert.equal((await ok('tar -caf a.tar.gz -C src . && od -An -tx1 -N2 a.tar.gz')).stdout.trim(), '1f 8b');

  // Archives on a pipe, both ends tar with gzip children.
  assert.equal((await ok('tar -czf - -C src . | tar -tzf - | sort')).stdout, LIST);

  // The compressor: tar forks, the child execs `sh -c <program>`, which
  // execs the program. It must be tar's own child under a pid /proc knows.
  await ok('printf "#!/bin/bash\\nsleep 1\\nexec gzip\\n" > slowgz && chmod +x slowgz');
  const tree = await ok([
    'tar -c --use-compress-program=/home/tar/slowgz -f y.tgz -C src . & T=$!',
    'sleep 0.4',
    'for p in /proc/[0-9]*; do n=${p#/proc/}; c=$(tr "\\0" " " < $p/cmdline 2>/dev/null); case "$c" in "bash /home/tar/slowgz"*) echo "gz=$n ppid=$(cut -d" " -f4 $p/stat)";; esac; done',
    'echo tar=$T; wait $T; echo rc=$?',
  ].join('; '));
  const tarPid = /^tar=(\d+)$/m.exec(tree.stdout)?.[1];
  const gz = /^gz=(\d+) ppid=(\d+)$/m.exec(tree.stdout);
  assert.ok(gz, `compressor not found in /proc: ${JSON.stringify(tree.stdout)}`);
  assert.equal(gz[2], tarPid, `compressor's parent is not tar: ${JSON.stringify(tree.stdout)}`);
  assert.match(tree.stdout, /^rc=0$/m);
  assert.equal((await ok('tar -tzf y.tgz | sort')).stdout, LIST);

  // The compressor's exit status reaches tar.
  await ok('printf "#!/bin/bash\\nexit 3\\n" > badgz && chmod +x badgz');
  const bad = await sh('tar -c --use-compress-program=/home/tar/badgz -f b.tgz -C src .');
  assert.equal(bad.status, 2, `failing compressor rc=${bad.status}`);
  assert.match(bad.stderr, /^tar: Child returned status 3$/m);

  // Errors.
  const corrupt = await sh('printf "not gzip" > c.tgz; tar -tzf c.tgz');
  assert.equal(corrupt.status, 2, `corrupt rc=${corrupt.status}`);
  assert.match(corrupt.stderr, /gzip: stdin: not in gzip format/);
  assert.match(corrupt.stderr, /tar: Child returned status 1/);
  const missing = await sh('tar -cf m.tar nope');
  assert.equal(missing.status, 2, `missing rc=${missing.status}`);
  assert.match(missing.stderr, /tar: nope: Cannot stat: No such file or directory/);
}
