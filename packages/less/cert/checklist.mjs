/**
 * less checklist (homescoop#123, PR #134): as a filter on a pipe, then on a
 * real pty (ctx.pty → kernel.openTerminal, TERM=xterm-256color from the
 * kernel, terminfo from the compiled-in ncurses fallbacks): -F -X, -N, -S,
 * +/pattern, secure mode (no shell escape), q, and a missing file.
 */
const ESC = '\x1b';
// What less shows of a line: drop CSI sequences, "x \b" pairs (less's
// end-of-row wrap trick on xterm) and carriage returns.
const plain = (s) =>
  s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/ \x08/g, '')
    .replace(/\r/g, '');

export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/less';
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  const long = Array.from({ length: 60 }, (_, i) => `line ${i + 1}${i === 41 ? ' needle here' : ''}`).join('\n') + '\n';
  const short = `alpha\nbeta\n${'x'.repeat(100)}END\n`;
  for (const [name, text] of [['long.txt', long], ['short.txt', short]]) {
    const w = await run(['bash', '-c', `cat > ${name}`], { cwd, stdin: text });
    assert.equal(w.status, 0, `write ${name} stderr=${w.stderr}`);
  }

  const ver = await run(['less', '--version'], { cwd });
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /^less 668 \(POSIX regular expressions\)$/m);

  // Not a terminal: less is a filter and copies its input unchanged.
  const pipe = await run(['bash', '-c', 'printf "a\\nb\\n" | less; less short.txt | wc -c'], { cwd });
  assert.equal(pipe.status, 0, `pipe stderr=${pipe.stderr}`);
  assert.equal(pipe.stdout, `a\nb\n${short.length}\n`);

  // Missing file: message, rc 0 (as upstream less 668).
  const miss = await run(['less', 'missing.txt'], { cwd });
  assert.equal(miss.status, 0, `missing rc=${miss.status}`);
  assert.equal(miss.stdout + miss.stderr, 'missing.txt: No such file or directory\n');

  // -F -X on a pty: fits one screen, so less prints it and exits by itself,
  // wrapping the 103-char line at 40 columns.
  const fx = await pty(['less', '-F', '-X', 'short.txt'], { cwd, cols: 40 });
  assert.equal(fx.status, 0, `-F -X status=${fx.status} out=${JSON.stringify(fx.out)}`);
  assert.ok(fx.out.startsWith(`${ESC}[?1h${ESC}=`), 'keypad mode first');
  assert.equal(plain(fx.out).trimEnd(), `alpha\nbeta\n${'x'.repeat(100)}END`);
  assert.doesNotMatch(fx.out, /not fully functional/);

  // -N: line numbers (bold), the wrapped line repeats its number per row.
  const n = await pty(['less', '-N', '-F', '-X', 'short.txt'], { cwd, cols: 40 });
  assert.equal(n.status, 0, `-N status=${n.status}`);
  assert.match(n.out, new RegExp(`      ${ESC}\\[1m1${ESC}\\[0m alpha\\r\\n      ${ESC}\\[1m2${ESC}\\[0m beta\\r\\n`));
  assert.ok(plain(n.out).includes('      3 xxxxEND'), `-N out=${JSON.stringify(n.out)}`);

  // -S: chop instead of wrap; the long line ends in a reverse-video '>'.
  const s = await pty(['less', '-S', '-X', 'short.txt'], { cwd, cols: 40, steps: [{ expect: 'short\\.txt \\(END\\)' }, { write: 'q' }] });
  assert.equal(s.status, 0, `-S status=${s.status} failed=${JSON.stringify(s.failedStep)}`);
  assert.ok(s.out.includes(`${'x'.repeat(39)}${ESC}[7m>${ESC}[27m`), `-S out=${JSON.stringify(s.out)}`);
  assert.doesNotMatch(plain(s.out), /END\n/);

  // +/pattern: starts at the first match (line 42), highlighted.
  const pat = await pty(['less', '-X', '+/needle', 'long.txt'], {
    cwd,
    cols: 40,
    rows: 10,
    steps: [{ expect: `line 42 ${ESC}\\[7mneedle${ESC}\\[27m here` }, { expect: 'long\\.txt', write: 'q' }],
  });
  assert.equal(pat.status, 0, `+/ status=${pat.status} failed=${JSON.stringify(pat.failedStep)}`);
  assert.ok(plain(pat.out).includes('line 42 needle here\nline 43\n'), `+/ out=${JSON.stringify(pat.out)}`);
  assert.doesNotMatch(plain(pat.out), /line 41\n/);

  // --with-secure: the shell escape is refused, less keeps running.
  const sec = await pty(['less', '-X', 'long.txt'], {
    cwd,
    cols: 40,
    rows: 10,
    steps: [{ expect: 'long\\.txt' }, { write: '!' }, { expect: 'Command not available' }, { write: 'q' }],
  });
  assert.equal(sec.status, 0, `secure status=${sec.status} failed=${JSON.stringify(sec.failedStep)} out=${JSON.stringify(sec.out)}`);
}
