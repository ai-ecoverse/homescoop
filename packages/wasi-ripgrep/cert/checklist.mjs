/**
 * wasi-ripgrep (homescoop#168): stdin. grep-cli's is_readable_stdin was
 * hard-coded false on WASI, so `cmd | rg pat` searched the cwd instead.
 * The patch reads stdin unless it is a tty, a character device or a
 * directory (the Linux rule; a WASI pipe has filetype UNKNOWN).
 */
export default async function (ctx) {
  const { run, pty, assert } = ctx;
  const cwd = '/home/rg';
  const sh = (script, opts = {}) => run(['bash', '-c', script], { cwd, ...opts });
  const mk = await run(['bash', '-c', `mkdir -p ${cwd}/sub && cd ${cwd} && printf 'alpha\\nbeta\\n' > f.txt && printf 'beta two\\n' > sub/g.txt`], { cwd: '/home' });
  assert.equal(mk.status, 0, `setup stderr=${mk.stderr}`);

  const ver = await run(['rg', '--version'], { cwd });
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /^ripgrep 15\.2\.0/);

  // Piped stdin is searched (the published -2 prints "No files were searched", rc 2).
  const p = await sh(`printf 'a\\nb\\n' | rg b`);
  assert.equal(p.status, 0, `pipe rc=${p.status} stderr=${p.stderr}`);
  assert.equal(p.stdout, 'b\n');
  const c = await sh(`printf 'x\\ny\\nx\\n' | rg -c x`);
  assert.equal(c.stdout, '2\n', `pipe -c stderr=${c.stderr}`);
  const miss = await sh(`printf 'a\\n' | rg zzz`);
  assert.equal(miss.status, 1, `pipe no match rc=${miss.status} stderr=${miss.stderr}`);
  assert.equal(miss.stdout, '');

  // A file redirect is stdin too.
  const r = await sh('rg beta < f.txt');
  assert.equal(r.status, 0, `redirect stderr=${r.stderr}`);
  assert.equal(r.stdout, 'beta\n');

  // stdin passed by the caller, and an explicit `-`.
  const s = await run(['rg', 'two'], { cwd, stdin: 'one\ntwo\n' });
  assert.equal(s.stdout, 'two\n', `ctx stdin stderr=${s.stderr}`);
  const d = await sh(`printf 'q\\n' | rg q -`);
  assert.equal(d.stdout, 'q\n');

  // A tty stdin still searches the cwd.
  const t = await pty(['rg', '--sort=path', '--color=never', '--no-heading', 'beta'], { cwd, cols: 120 });
  assert.equal(t.status, 0, `tty out=${JSON.stringify(t.out)}`);
  assert.match(t.out, /f\.txt:2:beta/);
  assert.match(t.out, /sub\/g\.txt:1:beta two/);

  // No stdin: search the cwd as before. Needs the kernel to give an absent
  // stdin as a character device (/dev/null), not an empty pipe.
  const n = await run(['rg', '--sort=path', '--no-heading', 'beta'], { cwd });
  assert.equal(n.status, 0, `no stdin rc=${n.status} stderr=${n.stderr}`);
  assert.equal(n.stdout, 'f.txt:2:beta\nsub/g.txt:1:beta two\n');

  // Explicit paths are unaffected.
  const e = await run(['rg', '--sort=path', '--no-heading', 'beta', '.'], { cwd });
  assert.equal(e.stdout, './f.txt:2:beta\n./sub/g.txt:1:beta two\n', `path stderr=${e.stderr}`);
}
