/**
 * nano checklist (homescoop#123, PR #135): --version, --help, the non-tty
 * refusal, and editing on a real pty (ctx.pty): type, ^O + Enter to write,
 * ^X to quit; edit an existing file; ^X on a modified buffer + N discards.
 * The saved bytes are compared exactly.
 */
const CTRL_O = '\x0f';
const CTRL_X = '\x18';
const CTRL_E = '\x05';

export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/nano';
  const go = (argv) => run(argv, { cwd });
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  const bytes = async (f) => {
    const r = await go(['base64', '-w0', f]);
    assert.equal(r.status, 0, `read ${f}: ${r.stderr}`);
    return Buffer.from(r.stdout, 'base64').toString('latin1');
  };

  const ver = await go(['nano', '--version']);
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /^ GNU nano, version 8\.7\.1$/m);
  assert.match(ver.stdout, /Compiled options: .*--enable-utf8/);

  const help = await go(['nano', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: nano \[OPTIONS\] \[\[\+LINE\[,COLUMN\]\] FILE\]\.\.\.$/m);
  assert.match(help.stdout, /^ -L +--nonewlines +Don't add an automatic newline$/m);

  // No terminal: nano refuses, rc 1, and leaves no file behind.
  const notty = await go(['nano', 'x.txt']);
  assert.equal(notty.status, 1, `non-tty rc=${notty.status}`);
  assert.equal(notty.stderr, 'Standard input is not a terminal\n');
  assert.notEqual((await go(['test', '-e', 'x.txt'])).status, 0, 'non-tty run created x.txt');

  // New file: type two lines, ^O, accept the name, ^X.
  const created = await pty(['nano', 'new.txt'], {
    cwd,
    steps: [
      { expect: '\\[ New File \\]' },
      { write: 'hello nano\rsecond line' },
      { sleepMs: 200, write: CTRL_O },
      { expect: 'Write to File: new\\.txt' },
      { write: '\r' },
      { expect: '\\[ Wrote 2 lines \\]' },
      { write: CTRL_X },
    ],
  });
  assert.equal(created.status, 0, `new file status=${created.status} failed=${JSON.stringify(created.failedStep)}`);
  assert.equal(await bytes('new.txt'), 'hello nano\nsecond line\n');

  // Existing file: it is shown, ^E goes to the end of line 1, the edit is
  // saved with ^O, and UTF-8 survives.
  const w = await run(['bash', '-c', 'cat > edit.txt'], { cwd, stdin: 'first\nsecond\n' });
  assert.equal(w.status, 0);
  const edited = await pty(['nano', 'edit.txt'], {
    cwd,
    steps: [
      { expect: '\\[ Read 2 lines \\]' },
      { write: `${CTRL_E} grün` },
      { sleepMs: 200, write: CTRL_O },
      { expect: 'Write to File: edit\\.txt' },
      { write: '\r' },
      { expect: '\\[ Wrote 2 lines \\]' },
      { write: CTRL_X },
    ],
  });
  assert.equal(edited.status, 0, `edit status=${edited.status} failed=${JSON.stringify(edited.failedStep)}`);
  assert.equal(await bytes('edit.txt'), Buffer.from('first grün\nsecond\n').toString('latin1'));

  // Modified buffer, ^X, N: nano asks, discards, the file is unchanged.
  const discarded = await pty(['nano', 'edit.txt'], {
    cwd,
    steps: [
      { expect: '\\[ Read 2 lines \\]' },
      { write: 'scratch ' },
      { sleepMs: 200, write: CTRL_X },
      { expect: 'Save modified buffer\\?' },
      { write: 'n' },
    ],
  });
  assert.equal(discarded.status, 0, `discard status=${discarded.status} failed=${JSON.stringify(discarded.failedStep)}`);
  assert.equal(await bytes('edit.txt'), Buffer.from('first grün\nsecond\n').toString('latin1'));
}
