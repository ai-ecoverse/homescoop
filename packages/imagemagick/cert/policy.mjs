const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap|out of memory/i;

export default async function policy(ctx) {
  const { assert } = ctx;
  const cwd = '/tmp/policy';
  const open = `/node_modules/${ctx.npmName}/etc/ImageMagick-7-open`;
  await ctx.write('/tmp/policy/.keep', '');
  const run = (argv, env) => ctx.run(argv, { cwd, ...(env ? { env } : {}) });
  const timed = async (argv, env) => {
    const t = Date.now();
    const r = await run(argv, env);
    return { ...r, ms: Date.now() - t };
  };
  const exists = async (p) => (await run(['magick', 'identify', '-format', '%w', p])).status === 0;
  const limits = (out) => Object.fromEntries([...out.matchAll(/^\s+([A-Za-z ]+): (\S+)$/gm)].map((m) => [m[1], m[2]]));

  const list = await run(['magick', '-list', 'resource']);
  assert.equal(list.status, 0, list.stderr);
  const tab = limits(list.stdout);
  assert.deepEqual(
    [tab.Width, tab.Height, tab.Area, tab.Memory, tab.Map, tab.Disk],
    ['16000P', '16000P', '64MP', '768MiB', '512MiB', '512MiB'],
    `default limits: ${list.stdout}`,
  );
  const pol = await run(['magick', '-list', 'policy']);
  assert.match(pol.stdout, /Path: \S*\/etc\/ImageMagick-7\/policy\.xml/);

  const huge = await timed(['magick', '-size', '30000x30000', 'xc:white', 'huge.png']);
  assert.equal(huge.status, 1, `30000x30000: rc ${huge.status} ${huge.stderr}`);
  assert.match(huge.stderr, /width or height exceeds limit `white' \(30000x30000\) > \(16000x16000\)/);
  assert.doesNotMatch(huge.stderr, FATAL);
  assert.ok(huge.ms < 15000, `30000x30000 took ${huge.ms} ms`);
  assert.equal(await exists('huge.png'), false, 'no huge.png');

  const area = await timed(['magick', '-size', '9000x9000', 'xc:white', 'area.png']);
  assert.equal(area.status, 1, `9000x9000 (81MP): rc ${area.status} ${area.stderr}`);
  assert.match(area.stderr, /cache resources exhausted/);
  assert.doesNotMatch(area.stderr, FATAL);
  assert.ok(area.ms < 15000, `9000x9000 took ${area.ms} ms`);

  const raise = await run(['magick', '-limit', 'width', '20KP', '-size', '17000x100', 'xc:white', 'raise.png']);
  assert.equal(raise.status, 1, '-limit cannot raise a policy limit');
  assert.match(raise.stderr, /width or height exceeds limit/);

  const photo = await timed(['magick', '-size', '8064x6048', 'gradient:red-blue', '-resize', '25%', '-quality', '85', 'photo.jpg']);
  assert.equal(photo.status, 0, `48MP resize: rc ${photo.status} ${photo.stderr}`);
  assert.doesNotMatch(photo.stderr, FATAL);
  const size = await run(['magick', 'identify', '-format', '%w %h', 'photo.jpg']);
  assert.equal(size.stdout, '2016 1512');

  const wide = ['-size', '17000x100', 'xc:white', '-resize', '10%'];
  const tabWide = await run(['magick', ...wide, 'wide-tab.png']);
  assert.equal(tabWide.status, 1, 'a 17000-wide canvas is over the tab policy');
  const lifted = await run(['magick-open', ...wide, 'wide-open.png']);
  assert.equal(lifted.status, 0, `magick-open: rc ${lifted.status} ${lifted.stderr}`);
  assert.equal((await run(['magick', 'identify', '-format', '%w %h', 'wide-open.png'])).stdout, '1700 10');
  const openList = limits((await run(['magick-open', '-list', 'resource'])).stdout);
  assert.notEqual(openList.Area, '64MP', 'magick-open reads policy-open');
  const envLifted = await run(['magick', ...wide, 'wide-env.png'], { MAGICK_CONFIGURE_PATH: open });
  assert.equal(envLifted.status, 0, `MAGICK_CONFIGURE_PATH=${open}: rc ${envLifted.status} ${envLifted.stderr}`);
  const envPol = await run(['magick', '-list', 'policy'], { MAGICK_CONFIGURE_PATH: open });
  assert.match(envPol.stdout, /Path: \S*\/etc\/ImageMagick-7-open\/policy\.xml/);
  console.log(`policy: 30000x30000 refused in ${huge.ms} ms, 9000x9000 in ${area.ms} ms, 8064x6048 resize ${photo.ms} ms; magick-open and MAGICK_CONFIGURE_PATH lift`);
}
