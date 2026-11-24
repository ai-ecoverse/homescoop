const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;

export default async function readErrors(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/readerr';
  await ctx.write(`${cwd}/.keep`, '');
  const run = (argv) => ctx.run(argv, { cwd });
  for (const [f, size] of [['a.png', '30x20'], ['b.jpg', '40x10'], ['f0.png', '11x11'], ['f2.png', '13x13']]) {
    const mk = await run(['magick', '-size', size, 'xc:red', f]);
    assert.equal(mk.status, 0, `${f}: ${mk.stderr}`);
  }
  for (const cmd of [['magick', 'identify'], ['identify']]) {
    const r = await run([...cmd, '-format', '%f %w %h\n', '*']);
    assert.equal(r.stdout, 'a.png 30 20\nb.jpg 40 10\nf0.png 11 11\nf2.png 13 13\n', `${cmd.join(' ')} '*' after the non-image .keep still lists every image (homescoop#2218): ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 1, `${cmd.join(' ')} '*' exits 1 for .keep: rc ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /keep/i, `the failure names .keep: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
  }
  const named = await run(['magick', 'identify', '-format', '%f\n', 'missing.png', 'a.png', '.keep', 'b.jpg']);
  assert.equal(named.stdout, 'a.png\nb.jpg\n', `identify missing.png a.png .keep b.jpg lists a.png and b.jpg (homescoop#2218): ${named.stdout}${named.stderr}`);
  assert.equal(named.status, 1, `rc ${named.status} ${named.stderr}`);
  assert.match(named.stderr, /missing\.png/, named.stderr);
  const scenes = await run(['magick', 'identify', '-format', '%w\n', 'f%d.png[0-2]']);
  assert.equal(scenes.stdout, '11\n13\n', `f%d.png[0-2] with f1.png missing reads f0.png and f2.png (homescoop#2218): ${scenes.stdout}${scenes.stderr}`);
  assert.equal(scenes.status, 1, `rc ${scenes.status} ${scenes.stderr}`);
  assert.match(scenes.stderr, /f1\.png/, scenes.stderr);

  await ctx.addUser({ name: 'dana' });
  const as = (user, script) => ctx.run(['bash', '-c', script], { cwd: '/tmp', ...(user && { user }) });
  const mk = await as('dana', 'mkdir -p ~/er && cd ~/er && magick -size 10x10 xc:red ro.png && chmod 444 ro.png');
  assert.equal(mk.status, 0, mk.stderr);
  const sec = await as(null, 'magick -size 10x10 xc:red /home/dana/er/sec.png && chmod 600 /home/dana/er/sec.png');
  assert.equal(sec.status, 0, sec.stderr);
  const ro = await as('dana', 'cd ~/er && magick -size 20x20 xc:blue ro.png; echo rc=$?; stat -c %a ro.png; magick identify -format "%w %h\\n" ro.png');
  assert.equal(ro.stdout, 'rc=1\n444\n10 10\n', `dana's write over her 0444 ro.png is refused and leaves it: ${ro.stdout}${ro.stderr}`);
  assert.match(ro.stderr, /unable to open image .ro\.png.: Permission denied/, `the refused write reports the open's errno, not one left by the path policy check (homescoop#2217): ${ro.stderr}`);
  const rd = await as('dana', 'cd ~/er && magick identify sec.png; echo rc=$?');
  assert.equal(rd.stdout, 'rc=1\n', `dana can't read root's 0600 sec.png: ${rd.stdout}${rd.stderr}`);
  assert.match(rd.stderr, /unable to open image .sec\.png.: Permission denied/, `the refused read reports the open's errno (homescoop#2217): ${rd.stderr}`);
  console.log('read-errors: identify goes on after a non-image or a missing file (\'*\', named files, f%d.png[0-2]) and exits 1 (homescoop#2218); a refused open reports Permission denied, for a write and a read (homescoop#2217)');
}
