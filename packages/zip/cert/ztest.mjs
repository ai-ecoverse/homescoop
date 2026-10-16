// homescoop#432: zip -T tests the archive with unzip, and -T -m deletes the
// originals only after the test passes. zip runs unzip itself (no /bin/sh),
// so an archive name with a quote or a $ is fine; -TT's command still runs
// through the shell. cert/noshell/ runs zip -T with no shell installed.
import { HOME, USER, sh } from './lib/zipkit.mjs';

export default async function ztest(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const cwd = `${HOME}/zt`;
  const run = (argv) => ctx.run(argv, { cwd, user: USER });
  const mk = await sh(ctx, "mkdir -p zt && cd zt && seq 1 2000 > seq.txt && printf 'm\\n' > move.txt");
  assert.equal(mk.status, 0, mk.stderr);

  const t = await run(['zip', '-T', 'best.zip', 'seq.txt']);
  assert.equal(t.status, 0, `zip -T: rc ${t.status}\n${t.stdout}${t.stderr}`);
  assert.match(t.stdout, /test of best\.zip OK/);

  // zip -T of an existing archive (no files to add) tests it under its own
  // name, which the shell used to see: a quote broke the command line.
  const odd = "it's $HOME.zip";
  assert.equal((await run(['zip', '-q', odd, 'seq.txt'])).status, 0);
  const q = await run(['zip', '-T', odd]);
  assert.equal(q.status, 0, `zip -T "${odd}": rc ${q.status}\n${q.stdout}${q.stderr}`);
  assert.match(q.stdout, /test of it's \$HOME\.zip OK/);

  const mv = await run(['zip', '-T', '-m', 'moved.zip', 'move.txt']);
  assert.equal(mv.status, 0, `zip -T -m: rc ${mv.status}\n${mv.stdout}${mv.stderr}`);
  assert.match(mv.stdout, /test of moved\.zip OK/);
  assert.equal((await run(['ls', 'move.txt'])).status, 2, 'zip -T -m removed move.txt');
  assert.equal((await run(['unzip', '-p', 'moved.zip', 'move.txt'])).stdout, 'm\n');

  const tt = await run(['zip', '-T', '-TT', 'unzip -tqq', 'tt.zip', 'seq.txt']);
  assert.equal(tt.status, 0, `zip -T -TT 'unzip -tqq': rc ${tt.status}\n${tt.stdout}${tt.stderr}`);
  assert.match(tt.stdout, /test of tt\.zip OK/);

  // A failing test fails zip (8) and keeps the originals: -TT false.
  const bad = await run(['zip', '-T', '-m', '-TT', 'false', 'bad.zip', 'seq.txt']);
  assert.equal(bad.status, 8, `zip -T -TT false: rc ${bad.status}\n${bad.stdout}${bad.stderr}`);
  assert.match(bad.stdout + bad.stderr, /test of bad\.zip FAILED/);
  assert.equal((await run(['ls', 'seq.txt'])).status, 0, 'a failed -T -m keeps seq.txt');
}
