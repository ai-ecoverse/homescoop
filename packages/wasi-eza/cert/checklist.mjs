/**
 * wasi-eza: eza lists a directory as on Linux. The long view's
 * permissions, owner, size and type come from 0001's slicc_fs calls
 * (path_filestat_owner, path_mode); `/` is the root, not the working
 * directory (0001's start()); with no file arguments eza lists the
 * working directory whatever its stdin is, and reads names from stdin only
 * with --stdin (0002).
 */
export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/eza';
  const eza = (args, opts = {}) => run(['eza', ...args], { cwd, ...opts });
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  const setup = await run(['bash', '-c', [
    `mkdir -p ${cwd}/sub/deep && cd ${cwd}`,
    "printf 'hello\\n' > a.txt && chmod 600 a.txt",
    "printf '#!/bin/sh\\nexit 0\\n' > run.sh && chmod 755 run.sh",
    'ln -s a.txt link && ln -s nowhere broken && mkfifo pipe',
    "printf 'hi\\n' > sub/deep/x.md && printf 'secret' > .hidden",
    'mkdir -m 1777 shared',
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, `setup: ${out(setup)}`);

  let r = await eza(['--version']);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'eza eza - A modern, maintained replacement for ls\nv0.23.5 [-git]\nhttps://github.com/eza-community/eza\n\n');

  // 0002: no stdin, /dev/null, a pipe with data or one nobody closes: the
  // working directory (0.23.5 unpatched lists nothing, or the pipe's lines).
  const names = 'a.txt\nbroken -> nowhere\nlink -> a.txt\npipe\nrun.sh\nshared\nsub\n';
  r = await eza(['-1']);
  assert.equal(r.stdout, names, `no stdin: ${out(r)}`);
  r = await run(['bash', '-c', 'eza -1 < /dev/null'], { cwd });
  assert.equal(r.stdout, names, `< /dev/null: ${out(r)}`);
  r = await eza(['-1'], { stdin: 'run.sh\n' });
  assert.equal(r.stdout, names, `piped names without --stdin: ${out(r)}`);
  r = await run(['bash', '-c', 'sleep 2 | eza -1'], { cwd });
  assert.equal(r.stdout, names, `open pipe: ${out(r)}`);
  r = await eza(['-1', '--stdin'], { stdin: 'a.txt\nsub\n' });
  assert.equal(r.stdout, 'a.txt\n\nsub:\ndeep\n', `--stdin: ${out(r)}`);

  // 0001: the long view, with modes (0600, 0755, 1777, a fifo, links) and
  // owners from the kernel.
  r = await eza(['-l', '--no-time']);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, [
    '.rw-------  6 root a.txt',
    'lrwxrwxrwx  - root broken -> nowhere',
    'lrwxrwxrwx  - root link -> a.txt',
    '|rw-r--r--  - root pipe',
    '.rwxr-xr-x 17 root run.sh',
    'drwxrwxrwt  - root shared',
    'drwxr-xr-x  - root sub',
    '',
  ].join('\n'), out(r));
  r = await eza(['-lad', '--no-time', '-o', '-g', '-n', '.hidden', 'a.txt', 'run.sh', 'shared']);
  assert.equal(r.stdout, [
    '0644 .rw-r--r--  6 0 0 .hidden',
    '0600 .rw-------  6 0 0 a.txt',
    '0755 .rwxr-xr-x 17 0 0 run.sh',
    '1777 drwxrwxrwt  - 0 0 shared',
    '',
  ].join('\n'), out(r));
  r = await eza(['-1aa']);
  assert.equal(r.stdout, `.\n..\n.hidden\n${names}`, out(r));
  r = await eza(['-T', 'sub']);
  assert.equal(r.stdout, 'sub\n└── deep\n    └── x.md\n', out(r));
  r = await eza(['-ld', '--no-time', '--total-size', 'sub']);
  assert.equal(r.stdout, 'drwxr-xr-x 3 root sub\n', `--total-size: ${out(r)}`);
  r = await eza(['-l', '--no-time', '-X', 'link']);
  assert.equal(r.stdout, 'lrw------- 6 root link\n', `--dereference: ${out(r)}`);
  r = await eza(['-l', '--no-time', '/dev/null']);
  assert.equal(r.stdout, 'crw-rw-rw- - root /dev/null\n', out(r));

  // Inodes and the inode sort agree; -H counts links.
  r = await eza(['-li', '--no-time', '-H', 'a.txt', 'run.sh', 'pipe']);
  const rows = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/));
  assert.equal(rows.length, 3, out(r));
  for (const row of rows) {
    assert.match(row[0], /^[1-9]\d*$/, `inode: ${out(r)}`);
    assert.equal(row[2], '1', `links: ${out(r)}`);
  }
  assert.equal(new Set(rows.map((row) => row[0])).size, 3, `distinct inodes: ${out(r)}`);
  const byInode = [...rows].sort((x, y) => (BigInt(x[0]) < BigInt(y[0]) ? -1 : 1)).map((row) => row.at(-1));
  r = await eza(['-1', '--sort=inode', 'a.txt', 'run.sh', 'pipe']);
  assert.equal(r.stdout, `${byInode.join('\n')}\n`, `--sort=inode: ${out(r)}`);

  // 0001's start(): / is the root (preopenRoot), relative paths still work.
  r = await eza(['-1', '/']);
  const top = r.stdout.split('\n');
  for (const d of ['dev', 'etc', 'home', 'tmp']) assert.ok(top.includes(d), `/ has ${d}: ${out(r)}`);
  assert.ok(!top.includes('a.txt'), `/ is not the working directory: ${out(r)}`);
  r = await eza(['-1d', '/', '/tmp', '../eza', 'sub/..', './sub/deep']);
  // Sorted by file name: .., /, deep, eza, tmp.
  assert.equal(r.stdout, 'sub/..\n/\n./sub/deep\n../eza\n/tmp\n', out(r));
  r = await eza(['-ld', '--no-time', '/tmp']);
  assert.equal(r.stdout, 'drwxrwxrwt - root /tmp\n', out(r));

  // Errors, and the build without git.
  r = await eza(['nothere']);
  assert.equal(r.status, 2, out(r));
  assert.equal(r.stderr, '"nothere": No such file or directory (os error 44)\n');
  r = await eza(['--git']);
  assert.equal(r.status, 3, out(r));
  assert.match(r.stderr, /`git` feature was disabled/);

  // A terminal: the grid fits slicc_tty.winsize's width; colours.
  let t = await pty(['eza', '--color=never'], { cwd, cols: 30 });
  assert.equal(t.status, 0, JSON.stringify(t));
  assert.equal(t.out, 'a.txt   link  run.sh  sub\r\nbroken  pipe  shared\r\n');
  t = await pty(['eza', '--color=never'], { cwd, cols: 200 });
  assert.equal(t.out, 'a.txt  broken  link  pipe  run.sh  shared  sub\r\n');
  t = await pty(['eza', '-l', '--no-time', 'run.sh', 'sub'], { cwd, cols: 120 });
  assert.equal(t.status, 0, JSON.stringify(t));
  assert.match(t.out, /\x1b\[1;32mrun\.sh\x1b\[0m/, `executable is bold green: ${JSON.stringify(t.out)}`);
  assert.match(t.out, /\x1b\[1;33mroot\x1b\[0m/, `root's own file: ${JSON.stringify(t.out)}`);
  assert.match(t.out, /\x1b\[1;34md/, `directory: ${JSON.stringify(t.out)}`);
}
