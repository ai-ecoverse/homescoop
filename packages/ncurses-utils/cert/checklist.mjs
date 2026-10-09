/**
 * ncurses-utils checklist: clear, tput, reset against slicc-kernel.
 * TERMINFO comes from the package's slicc.env (share/terminfo); TERM is set
 * per case because one-shot runs have no terminal and no TERM of their own.
 * tput cols/lines and reset run on a real pty (kernel.openTerminal).
 */
const XT = { TERM: 'xterm-256color' };
const E = '\x1b';

export default async function (ctx) {
  const { run, assert, page } = ctx;
  const go = (argv, env = XT) => run(argv, { cwd: '/home', env });

  // A pty of a given size: collect its output until the program exits.
  const pty = (argv, { cols = 80, rows = 24, env = XT } = {}) =>
    page.evaluate(
      async ({ argv, cols, rows, env }) => {
        const chunks = [];
        const t = await window.kernel.openTerminal(argv, { cols, rows, env, cwd: '/home' });
        t.onData = (b) => chunks.push(...b);
        const status = await t.exited;
        await new Promise((r) => setTimeout(r, 50));
        return { status, out: new TextDecoder().decode(new Uint8Array(chunks)) };
      },
      { argv, cols, rows, env },
    );

  // clear: home, erase display, and erase scrollback (E3, kept by tic -x).
  const clear = await go(['clear']);
  assert.equal(clear.status, 0, `clear stderr=${clear.stderr}`);
  assert.equal(clear.stdout, `${E}[H${E}[2J${E}[3J`, `clear bytes ${JSON.stringify(clear.stdout)}`);

  // `clear && …`, the reason for this package, from bash.
  const chain = await go(['bash', '-c', 'clear && echo after-clear']);
  assert.equal(chain.status, 0, `clear && stderr=${chain.stderr}`);
  assert.equal(chain.stdout, `${E}[H${E}[2J${E}[3Jafter-clear\n`);

  // A TERM that only the shipped database has (not a compiled-in fallback):
  // proves TERMINFO from slicc.env is found.
  const screen = await go(['clear'], { TERM: 'screen-256color' });
  assert.equal(screen.status, 0, `screen-256color stderr=${screen.stderr}`);
  assert.equal(screen.stdout, `${E}[H${E}[J`);

  // dumb has no clear capability: ncurses prints nothing and exits 1.
  const dumb = await go(['clear'], { TERM: 'dumb' });
  assert.equal(dumb.status, 1, `TERM=dumb clear rc=${dumb.status}`);
  assert.equal(dumb.stdout, '');

  // Unknown terminal: a clear error and a non-zero status.
  const bogus = await go(['clear'], { TERM: 'hs-no-such-term' });
  assert.notEqual(bogus.status, 0, 'unknown TERM should fail');
  assert.match(bogus.stderr, /'hs-no-such-term': unknown terminal type/);
  const tbogus = await go(['tput', 'cols'], { TERM: 'hs-no-such-term' });
  assert.equal(tbogus.status, 3, `tput unknown TERM rc=${tbogus.status}`);
  assert.match(tbogus.stderr, /unknown terminal "hs-no-such-term"/);

  // tput setaf 1 / sgr0: the colour and reset sequences.
  const red = await go(['tput', 'setaf', '1']);
  assert.equal(red.status, 0, `tput setaf stderr=${red.stderr}`);
  assert.equal(red.stdout, `${E}[31m`);
  const sgr0 = await go(['tput', 'sgr0']);
  assert.equal(sgr0.stdout, `${E}(B${E}[m`);
  const colors = await go(['tput', 'colors']);
  assert.equal(colors.stdout, '256\n');

  // tput cols / lines follow the pty's size.
  const cols = await pty(['tput', 'cols'], { cols: 123, rows: 45 });
  assert.equal(cols.status, 0, `tput cols on pty: ${JSON.stringify(cols)}`);
  assert.equal(cols.out.trim(), '123');
  const lines = await pty(['tput', 'lines'], { cols: 123, rows: 45 });
  assert.equal(lines.out.trim(), '45', `tput lines on pty: ${JSON.stringify(lines)}`);

  // reset returns 0 and the shell carries on, still on the same terminal.
  const reset = await pty(['bash', '-c', 'reset; echo "rc=$?"; tput cols'], { cols: 100, rows: 30 });
  assert.equal(reset.status, 0, `reset on pty: ${JSON.stringify(reset)}`);
  assert.match(reset.out, /rc=0\r?\n100\r?\n?$/, `after reset: ${JSON.stringify(reset.out)}`);
}
