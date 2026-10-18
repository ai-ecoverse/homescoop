// homescoop#562, write-temp-then-rename.patch: WriteImages writes a single
// output file to <target>.xxxxxxxx~ beside it and renames that over the
// target only once the write succeeded. Upstream opened (truncated) the
// target first, so a write that failed after OpenBlob ("cache resources
// exhausted" when -depth 8 needs a second pixel cache) left a truncated or
// clobbered file behind, with rc 1.
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;

export default async function atomicWrite(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/atomic562';
  await ctx.write(`${cwd}/.keep`, '');
  const run = (argv) => ctx.run(argv, { cwd });
  const ls = async () => (await run(['magick', 'identify', '-format', '%f\\n', '*'])).stdout.trim().split('\n').filter(Boolean).sort();
  const ok = async (argv) => {
    const r = await run(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    return r;
  };
  const failsKeeping = async (argv, target) => {
    const before = await ctx.readBytes(`${cwd}/${target}`);
    const r = await run(argv);
    assert.equal(r.status, 1, `${argv.join(' ')}: rc ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /cache resources exhausted/, `${argv.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, FATAL);
    const after = await ctx.readBytes(`${cwd}/${target}`);
    if (before === null) assert.equal(after, null, `${target} exists after a failed write (homescoop#562)`);
    else assert.ok(after !== null && Buffer.compare(before, after) === 0, `${target} changed after a failed write (homescoop#562: truncated or clobbered)`);
  };

  await ok(['magick', '-size', '64x64', 'xc:blue', 'orig.png']);
  const forced = ['-size', '2000x1000', 'gradient:', '-limit', 'memory', '20MiB', '-limit', 'map', '0', '-depth', '8'];
  await failsKeeping(['magick', ...forced, 'orig.png'], 'orig.png');
  await failsKeeping(['magick', ...forced, 'new.png'], 'new.png');
  assert.deepEqual(await ls(), ['orig.png'], 'no temporary file is left beside the target');

  const good = await ok(['magick', '-size', '300x200', 'gradient:red-blue', 'orig.png']);
  assert.equal(good.stderr, '');
  assert.equal((await run(['identify', '-format', '%m %w %h', 'orig.png'])).stdout, 'PNG 300 200', 'a successful write still replaces the target');
  await ok(['magick', '-size', '30x20', 'xc:red', 'xc:blue', '-adjoin', 'two.gif']);
  assert.equal((await run(['identify', '-format', '%n\n', 'two.gif'])).stdout.trim().split('\n')[0], '2', 'an adjoined multi-frame write keeps every frame');
  assert.deepEqual(await ls(), ['orig.png', 'two.gif', 'two.gif'], 'no temporary files after successful writes');
  console.log('atomic-write: a failed -depth 8 PNG write (cache resources exhausted) leaves the existing target byte-identical and creates no new one, no *~ left; good writes replace the target, adjoined frames intact');
}
