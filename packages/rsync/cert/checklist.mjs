/**
 * rsync checklist (homescoop#94): local copies. Every case runs a real local
 * rsync, which forks a receiver (and the receiver a generator) that talk to
 * the sender over pipes; outputs are what upstream rsync 3.4.4 prints.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/rs';
  const sh = (script) => run(['bash', '-c', script], { cwd });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  // Path, mode, mtime and content hash of every entry under a tree.
  const snap = async (dir) =>
    (
      await ok(
        `cd ${dir} && shopt -s globstar dotglob && for p in **; do ` +
          `if [ -f "$p" ]; then echo "$p $(stat -c '%a %Y' "$p") $(md5sum < "$p" | cut -c1-32)"; ` +
          `else echo "$p $(stat -c '%a' "$p")/"; fi; done`,
      )
    ).stdout;
  const lines = (s) => s.split('\n').filter(Boolean);

  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);

  const ver = await ok('rsync --version');
  assert.match(ver.stdout, /^rsync {2}version 3\.4\.4 {2}protocol version 32$/m);

  // A source tree with nested dirs, modes and old mtimes.
  await ok(
    'mkdir -p src/a/b src/c src/logs && echo one > src/a/f1 && echo two > src/a/b/f2 && ' +
      'echo three > src/c/f3 && echo top > src/top.txt && echo noise > src/logs/x.log && echo n2 > src/debug.log && ' +
      'chmod 640 src/a/f1 && chmod 755 src/c/f3 && chmod 750 src/c && ' +
      'touch -d @1577934245 src/a/f1 src/a/b/f2 src/c/f3 src/top.txt src/logs/x.log src/debug.log && ' +
      'touch -d @1620284889 src/a/b src/a src/c src/logs',
  );
  const srcSnap = await snap('src');

  // --itemize-changes on a fresh copy: upstream's order and change strings.
  const first = await ok('rsync -a --itemize-changes src/ dst/');
  assert.deepEqual(lines(first.stdout), [
    'created directory dst',
    'cd+++++++++ ./',
    '>f+++++++++ debug.log',
    '>f+++++++++ top.txt',
    'cd+++++++++ a/',
    '>f+++++++++ a/f1',
    'cd+++++++++ a/b/',
    '>f+++++++++ a/b/f2',
    'cd+++++++++ c/',
    '>f+++++++++ c/f3',
    'cd+++++++++ logs/',
    '>f+++++++++ logs/x.log',
  ]);
  // -a keeps modes and mtimes (files and directories) and contents.
  assert.equal(await snap('dst'), srcSnap, 'rsync -a copy differs from source');
  assert.match(srcSnap, /^a\/f1 640 1577934245 /m);
  assert.match(srcSnap, /^c 750\/$/m);
  const dirTimes = await ok('stat -c "%n %Y" src/a src/c dst/a dst/c');
  const [sa, sc, da, dc] = lines(dirTimes.stdout).map((l) => l.split(' ')[1]);
  assert.deepEqual([da, dc], [sa, sc], `directory mtimes: ${dirTimes.stdout}`);

  // Nothing changed: nothing transferred.
  const idle = await ok('rsync -a --stats src/ dst/');
  assert.match(idle.stdout, /^Number of regular files transferred: 0$/m);

  // Incremental: one changed file is the only one sent (--stats).
  await ok('echo two-changed > src/a/b/f2');
  const inc = await ok('rsync -a -i --stats src/ dst/');
  assert.match(inc.stdout, /^Number of regular files transferred: 1$/m);
  assert.match(inc.stdout, /^>f\.st\.{6} a\/b\/f2$/m);
  assert.deepEqual(lines(inc.stdout).filter((l) => /^>f/.test(l)), ['>f.st...... a/b/f2']);
  assert.equal((await ok('cat dst/a/b/f2')).stdout, 'two-changed\n');

  // --delete mirrors: an extra file and dir in dst go.
  await ok('mkdir -p dst/stale && echo x > dst/stale/s && echo y > dst/extra');
  // -n / --dry-run: lists what it would do, changes nothing.
  const dry = await ok('rsync -av --delete --dry-run src/ dst/');
  assert.match(dry.stdout, /^deleting stale\/s$/m);
  assert.match(dry.stdout, /^deleting stale\/$/m);
  assert.match(dry.stdout, /^deleting extra$/m);
  assert.match(dry.stdout, /\(DRY RUN\)$/m);
  assert.equal((await ok('ls dst/extra dst/stale/s')).status, 0);
  const dryN = await ok('echo changed-again > src/top.txt && rsync -ai -n src/ dst/');
  assert.match(dryN.stdout, /^>f\.st\.{6} top\.txt$/m);
  assert.equal((await ok('cat dst/top.txt')).stdout, 'top\n', '-n wrote a file');
  await ok('rsync -a --delete src/ dst/');
  assert.equal(await snap('dst'), await snap('src'), 'rsync -a --delete did not mirror');

  // --exclude: a pattern and a directory, also kept from --delete.
  const ex = await ok("rsync -a --exclude='*.log' --exclude=logs/ -i src/ ex/");
  assert.ok(!/\.log|logs/.test(ex.stdout), ex.stdout);
  assert.equal((await sh('ls ex/debug.log')).status, 2);
  assert.equal((await sh('ls ex/logs')).status, 2);
  await ok('echo keep > ex/kept.log');
  await ok("rsync -a --delete --exclude='*.log' src/ ex/");
  assert.equal((await ok('cat ex/kept.log')).stdout, 'keep\n', 'excluded file deleted');

  // -c: same size and mtime but other bytes. The quick check skips it, -c sends it.
  await ok('mkdir -p cs cd && echo AAAA > cs/f && echo BBBB > cd/f && touch -d @1643767322 cs/f cd/f');
  const quick = await ok('rsync -a -i cs/ cd/');
  assert.equal(quick.stdout, '', `quick check should skip: ${quick.stdout}`);
  assert.equal((await ok('cat cd/f')).stdout, 'BBBB\n');
  const sum = await ok('rsync -a -c -i cs/ cd/');
  assert.match(sum.stdout, /^>fc\.{8} f$/m);
  assert.equal((await ok('cat cd/f')).stdout, 'AAAA\n');

  // A missing source: upstream's exit code 23 and message.
  const miss = await sh('rsync -a nosuch/ out/');
  assert.equal(miss.status, 23, `missing source rc=${miss.status} stderr=${miss.stderr}`);
  assert.match(miss.stderr, /change_dir "\/home\/rs\/nosuch" failed: No such file or directory/);
  assert.match(miss.stderr, /rsync error: some files\/attrs were not transferred .*\(code 23\)/);
  const miss2 = await sh('rsync -a nosuch out/');
  assert.equal(miss2.status, 23, `missing file rc=${miss2.status}`);
  assert.match(miss2.stderr, /link_stat "\/home\/rs\/nosuch" failed/);

  // Ctrl-C mid-sync: SIGINT to the job (a --bwlimit transfer of a 4 MB file,
  // about 16 s) ends it with code 20, and no rsync process is left behind.
  await ok('mkdir -p big && yes 0123456789abcdef | head -c 4000000 > big/z');
  const t0 = Date.now();
  const intr = await sh(
    'timeout -s INT --preserve-status 2 rsync -a --bwlimit=250 big/ bigout/; echo "rc=$?"; sleep 1; ps -eo comm',
  );
  const secs = (Date.now() - t0) / 1000;
  assert.match(intr.stdout, /^rc=20$/m, `interrupt: ${intr.stdout} stderr=${intr.stderr}`);
  assert.match(intr.stderr, /received SIGINT, SIGTERM, or SIGHUP \(code 20\)/);
  assert.ok(secs < 10, `interrupt took ${secs}s`);
  assert.ok(!/^rsync$/m.test(intr.stdout), `orphaned rsync processes:\n${intr.stdout}`);
  const after = await ok('ps -eo comm');
  assert.ok(!/^rsync$/m.test(after.stdout), `rsync still running:\n${after.stdout}`);

  // --bwlimit throttles (the select() wrapper sleeps): 1 MB at 500 KB/s ≥ 1.5 s.
  await ok('head -c 1000000 big/z > one && mkdir -p bw');
  const b0 = Date.now();
  await ok('rsync --bwlimit=500 one bw/');
  const bsecs = (Date.now() - b0) / 1000;
  assert.ok(bsecs >= 1.5, `--bwlimit=500 for 1 MB took ${bsecs}s`);
}
