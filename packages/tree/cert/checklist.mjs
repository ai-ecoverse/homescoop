/**
 * tree checklist (homescoop#92): the slicc 6 man page options (-L, -a, -d,
 * -f, --help) plus -J, on a fixture with a hidden file and a hidden dir.
 * Default output uses UTF-8 line drawing; tree pads the vertical bar with
 * two no-break spaces (U+00A0), so those are spelled out below.
 */
const BAR = '│   ';
const TEE = '├── ';
const END = '└── ';
const GAP = '    ';

export default async function (ctx) {
  const { run, assert } = ctx;
  const tree = (args, cwd = '/home/tt') => run(['tree', ...args], { cwd });

  const setup = await run(
    [
      'bash',
      '-c',
      [
        'rm -rf /home/tt',
        'mkdir -p /home/tt/src/lib /home/tt/docs /home/tt/.hidden',
        'cd /home/tt',
        'echo int > src/main.c',
        'echo int > src/lib/util.c',
        'echo hi > docs/readme.md',
        'echo top > top.txt',
        'echo SECRET=1 > .env',
        'echo s > .hidden/secret',
      ].join(' && '),
    ],
    { cwd: '/home' },
  );
  assert.equal(setup.status, 0, `setup stderr=${setup.stderr}`);

  // Plain tree: the whole fixture, dotfiles skipped.
  const plain = await tree([]);
  assert.equal(plain.status, 0, `tree stderr=${plain.stderr}`);
  assert.equal(
    plain.stdout,
    [
      '.',
      `${TEE}docs`,
      `${BAR}${END}readme.md`,
      `${TEE}src`,
      `${BAR}${TEE}lib`,
      `${BAR}${BAR}${END}util.c`,
      `${BAR}${END}main.c`,
      `${END}top.txt`,
      '',
      '3 directories, 4 files',
      '',
    ].join('\n'),
    `tree stdout=${JSON.stringify(plain.stdout)}`,
  );

  // A directory argument becomes the root line.
  const arg = await tree(['/home/tt/docs'], '/home');
  assert.equal(arg.status, 0, `tree DIR stderr=${arg.stderr}`);
  assert.equal(arg.stdout, `/home/tt/docs\n${END}readme.md\n\n1 directory, 1 file\n`);

  // -L 2: src/lib is listed, its contents are not.
  const l2 = await tree(['-L', '2']);
  assert.equal(l2.status, 0, `tree -L 2 stderr=${l2.stderr}`);
  assert.equal(
    l2.stdout,
    [
      '.',
      `${TEE}docs`,
      `${BAR}${END}readme.md`,
      `${TEE}src`,
      `${BAR}${TEE}lib`,
      `${BAR}${END}main.c`,
      `${END}top.txt`,
      '',
      '3 directories, 3 files',
      '',
    ].join('\n'),
    `tree -L 2 stdout=${JSON.stringify(l2.stdout)}`,
  );

  // -a: dotfiles and dot-directories too.
  const all = await tree(['-a']);
  assert.equal(all.status, 0, `tree -a stderr=${all.stderr}`);
  assert.match(all.stdout, new RegExp(`^${TEE}\\.env$`, 'm'), `tree -a: ${JSON.stringify(all.stdout)}`);
  assert.match(all.stdout, new RegExp(`^${TEE}\\.hidden\\n${BAR}${END}secret$`, 'm'));
  assert.match(all.stdout, /\n4 directories, 6 files\n$/);

  // -d: directories only.
  const dirs = await tree(['-d']);
  assert.equal(dirs.status, 0, `tree -d stderr=${dirs.stderr}`);
  assert.equal(
    dirs.stdout,
    ['.', `${TEE}docs`, `${END}src`, `${GAP}${END}lib`, '', '3 directories', ''].join('\n'),
    `tree -d stdout=${JSON.stringify(dirs.stdout)}`,
  );

  // -f: full path prefix on every entry.
  const full = await tree(['-f']);
  assert.equal(full.status, 0, `tree -f stderr=${full.stderr}`);
  for (const p of ['./docs', './docs/readme.md', './src/lib/util.c', './src/main.c', './top.txt']) {
    assert.match(full.stdout, new RegExp(`(${TEE}|${END})${p.replace(/\./g, '\\.')}$`, 'm'), `tree -f missing ${p}: ${JSON.stringify(full.stdout)}`);
  }

  // -J: JSON that parses, with the tree and the report.
  const json = await tree(['-J']);
  assert.equal(json.status, 0, `tree -J stderr=${json.stderr}`);
  const doc = JSON.parse(json.stdout);
  assert.equal(doc.length, 2, `tree -J: ${json.stdout}`);
  const [root, report] = doc;
  assert.equal(root.type, 'directory');
  assert.equal(root.name, '.');
  assert.deepEqual(root.contents.map((e) => `${e.type}:${e.name}`), ['directory:docs', 'directory:src', 'file:top.txt']);
  const src = root.contents.find((e) => e.name === 'src');
  assert.deepEqual(src.contents.map((e) => e.name), ['lib', 'main.c']);
  assert.deepEqual(src.contents[0].contents, [{ type: 'file', name: 'util.c' }]);
  assert.equal(report.type, 'report');
  assert.equal(report.directories, 3);
  assert.equal(report.files, 4);

  // --help: usage on stdout, rc 0.
  const help = await tree(['--help']);
  assert.equal(help.status, 0, `tree --help rc=${help.status} stderr=${help.stderr}`);
  assert.match(help.stdout, /usage:\W*tree/);
  assert.match(help.stdout, /-L\W+level\W+Descend only/);

  // Errors: a missing directory (rc 2) and a bad -L (rc 1).
  const miss = await tree(['/home/tt-no-such-dir'], '/home');
  assert.equal(miss.status, 2, `missing dir rc=${miss.status} stdout=${miss.stdout} stderr=${miss.stderr}`);
  assert.match(miss.stdout + miss.stderr, /tt-no-such-dir\s+\[error opening dir\]/);
  const bad = await tree(['-L', '0']);
  assert.equal(bad.status, 1, `tree -L 0 rc=${bad.status}`);
  assert.match(bad.stderr, /Invalid level, must be greater than 0/);
}
