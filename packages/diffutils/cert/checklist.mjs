/**
 * diffutils checklist (#123): diff (-u, -q, -r, binary, exit codes 0/1/2),
 * cmp (-l, EOF), sdiff (side by side, -o merge) and diff3 (-m with
 * conflict markers). sdiff and diff3 run diff as a child (fork + exec):
 * before 3.12.0-1 they failed ("sdiff: diff: Exec format error",
 * "diff3: fork: Function not implemented"). Expected bytes are GNU
 * diffutils 3.12 on the host.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/diffutils';
  const sh = (script) => run(['bash', '-c', script], { cwd });
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  const setup = await sh([
    'printf "a\\nb\\nc\\n" > x', 'cp x x2', 'printf "a\\nB\\nc\\n" > y', 'printf "a\\nb\\nC\\n" > z',
    'printf "a\\nX\\nc\\n" > w', 'printf "a\\nB\\nc\\nd\\n" > y4',
    'printf "\\x00\\x01\\x02" > b1', 'printf "\\x00\\x01\\x03" > b2',
    'mkdir -p A/s B/s', 'printf "1\\n" > A/s/f', 'printf "2\\n" > B/s/f', 'printf "o\\n" > A/only',
  ].join(' && '));
  assert.equal(setup.status, 0, `setup stderr=${setup.stderr}`);
  const exp = async (script, status, stdout, stderr = '') => {
    const r = await sh(script);
    assert.equal(r.status, status, `${script}: rc=${r.status} stderr=${r.stderr}`);
    assert.equal(r.stdout, stdout, `${script}: stdout`);
    if (stderr !== null) assert.equal(r.stderr, stderr, `${script}: stderr`);
  };

  await exp('diff --version | head -1', 0, 'diff (GNU diffutils) 3.12\n');

  // diff: identical 0, different 1, trouble 2.
  await exp('diff x x2', 0, '');
  await exp('diff -u --label x --label y4 x y4', 1, '--- x\n+++ y4\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n');
  await exp('diff -q x y', 1, 'Files x and y differ\n');
  await exp('diff -r A B', 1, 'Only in A: only\ndiff -r A/s/f B/s/f\n1c1\n< 1\n---\n> 2\n');
  await exp('diff b1 b2', 1, 'Binary files b1 and b2 differ\n');
  await exp('diff x nope', 2, '', 'diff: nope: No such file or directory\n');

  // cmp.
  await exp('cmp x x2', 0, '');
  await exp('cmp x y', 1, 'x y differ: char 3, line 2\n');
  await exp('cmp -l x y4', 1, '3 142 102\n', null);
  const eof = await sh('cmp x y4');
  assert.match(eof.stdout + eof.stderr, /differ: char 3, line 2/);

  // sdiff: side by side, and an interactive merge (-o) driven from stdin.
  await exp('sdiff -w 30 x y', 1, 'a\t\ta\nb\t      |\tB\nc\t\tc\n');
  await exp('printf "l\\nr\\n" | sdiff -o merged x y >/dev/null; s=$?; cat merged; exit $s', 1, 'a\nb\nc\n');

  // diff3 -m: adjacent edits conflict; one overlapping line conflicts.
  await exp('diff3 -m y x z', 1, 'a\n<<<<<<< y\nB\nc\n||||||| x\nb\nc\n=======\nb\nC\n>>>>>>> z\n');
  await exp('diff3 -m y x w', 1, 'a\n<<<<<<< y\nB\n||||||| x\nb\n=======\nX\n>>>>>>> w\nc\n');
  await exp('diff3 x x2 x', 0, '');
}
