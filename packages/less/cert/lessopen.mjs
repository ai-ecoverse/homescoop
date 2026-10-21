const plain = (s) =>
  s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/ \x08/g, '')
    .replace(/\r/g, '');

export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/lessopen';
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  const sh = (script) => run(['bash', '--norc', '-c', script], { cwd });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc ${r.status} ${r.stdout}${r.stderr}`);
    return r;
  };
  await ok("printf 'alpha\\nbeta\\n' > a.txt && cp a.txt b.txt && xz -k b.txt && rm b.txt");

  const cat = await ok("LESSOPEN='|cat %s' LESSCLOSE='echo closed %s %s >> close.log' less a.txt; cat close.log");
  assert.equal(cat.stdout, 'alpha\nbeta\nclosed a.txt -\n', `|cat out=${JSON.stringify(cat.stdout)} err=${cat.stderr}`);

  const tr = await ok("LESSOPEN='|tr a-z A-Z < %s' less a.txt");
  assert.equal(tr.stdout, 'ALPHA\nBETA\n', `|tr out=${JSON.stringify(tr.stdout)} err=${tr.stderr}`);

  const empty = await ok("LESSOPEN='|true %s' less a.txt");
  assert.equal(empty.stdout, 'alpha\nbeta\n', 'an empty |pipe falls back to the file itself');

  const alt = await ok("LESSOPEN='tr a-z A-Z < %s > alt.txt; echo alt.txt' less a.txt");
  assert.equal(alt.stdout, 'ALPHA\nBETA\n', `alt file out=${JSON.stringify(alt.stdout)} err=${alt.stderr}`);

  await ok('rm -f close.log');
  const xz = await pty(
    ['bash', '--norc', '-c', "LESSOPEN='|xz -dc %s' LESSCLOSE='echo closed %s %s >> close.log' less -F -X b.txt.xz"],
    { cwd, cols: 40 },
  );
  assert.equal(xz.status, 0, `xz status=${xz.status} out=${JSON.stringify(xz.out)}`);
  assert.equal(plain(xz.out).trimEnd(), 'alpha\nbeta', `xz out=${JSON.stringify(xz.out)}`);
  assert.doesNotMatch(xz.out, /may be a binary file/);
  assert.equal((await ok('cat close.log')).stdout, 'closed b.txt.xz -\n');

  const sec = await pty(['less', '-X', 'a.txt'], {
    cwd,
    cols: 40,
    rows: 10,
    steps: [{ expect: 'a\\.txt' }, { write: '!' }, { expect: 'Command not available' }, { write: 'q' }],
  });
  assert.equal(sec.status, 0, `secure status=${sec.status} failed=${JSON.stringify(sec.failedStep)}`);
  console.log("lessopen: LESSOPEN '|cat %s' and '|tr a-z A-Z < %s' pipes feed less, an empty pipe falls back to the file, a LESSOPEN that prints a file name shows that file, '|xz -dc %s' shows an .xz file's text on a pty through less -F, LESSCLOSE runs after each, and '!' is still refused (homescoop#1484)");
}
