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
    ['64000P', '64000P', '64MP', '1.5GiB', '256MiB', '0B'],
    `default limits: ${list.stdout}`,
  );
  const pol = await run(['magick', '-list', 'policy']);
  assert.match(pol.stdout, /Path: \S*\/etc\/ImageMagick-7\/policy\.xml/);

  // 900 MP: within width/height (64KP), refused by area (64MP) before any allocation.
  const huge = await timed(['magick', '-size', '30000x30000', 'xc:white', 'huge.png']);
  assert.equal(huge.status, 1, `30000x30000: rc ${huge.status} ${huge.stderr}`);
  assert.match(huge.stderr, /cache resources exhausted/);
  assert.doesNotMatch(huge.stderr, FATAL);
  assert.ok(huge.ms < 15000, `30000x30000 took ${huge.ms} ms`);
  assert.equal(await exists('huge.png'), false, 'no huge.png');

  const long = await timed(['magick', '-size', '70000x10', 'xc:white', 'long.png']);
  assert.equal(long.status, 1, `70000x10: rc ${long.status} ${long.stderr}`);
  assert.match(long.stderr, /width or height exceeds limit `white' \(70000x10\) > \(64000x64000\)/);
  assert.doesNotMatch(long.stderr, FATAL);
  assert.ok(long.ms < 15000, `70000x10 took ${long.ms} ms`);

  const area = await timed(['magick', '-size', '9000x9000', 'xc:white', 'area.png']);
  assert.equal(area.status, 1, `9000x9000 (81MP): rc ${area.status} ${area.stderr}`);
  assert.match(area.stderr, /cache resources exhausted/);
  assert.doesNotMatch(area.stderr, FATAL);
  assert.ok(area.ms < 15000, `9000x9000 took ${area.ms} ms`);

  const raise = await run(['magick', '-limit', 'width', '80KP', '-size', '70000x10', 'xc:white', 'raise.png']);
  assert.equal(raise.status, 1, '-limit cannot raise a policy limit');
  assert.match(raise.stderr, /width or height exceeds limit/);

  const bounded = async (argv, ms) => {
    const t = Date.now();
    let timer;
    const r = await Promise.race([
      run(argv),
      new Promise((res) => {
        timer = setTimeout(() => res(null), ms);
      }),
    ]);
    clearTimeout(timer);
    assert.ok(r, `${argv.join(' ')}: no result within ${ms / 1000} s (pixel cache on disk? homescoop#356)`);
    return { ...r, ms: Date.now() - t };
  };
  const times = [];
  for (const [mp, w, h] of [[12, 4000, 3000], [24, 6000, 4000], [48, 8064, 6048]]) {
    for (const pct of [50, 25]) {
      const out = `photo-${mp}-${pct}.jpg`;
      const r = await bounded(['magick', '-size', `${w}x${h}`, 'gradient:red-blue', '-resize', `${pct}%`, '-quality', '85', out], 30000);
      assert.equal(r.status, 0, `${mp} MP resize ${pct}%: rc ${r.status} ${r.stderr}`);
      assert.doesNotMatch(r.stderr, FATAL);
      const size = await run(['magick', 'identify', '-format', '%w %h', out]);
      assert.equal(size.stdout, `${Math.round((w * pct) / 100)} ${Math.round((h * pct) / 100)}`);
      times.push(`${mp}MP/${pct}% ${r.ms} ms`);
    }
  }
  const photo = { ms: times.join(', ') };

  // homescoop#445: a panorama wider than 16000 px (18000x3000, 54 MP, under the
  // 64 MP area) decodes and resizes under the tab policy; identify -format
  // decodes it too (7.1.2-34-1: 'width or height exceeds limit', rc 1).
  const pano = await bounded(['magick-open', '-size', '18000x3000', 'gradient:blue-green', '-quality', '85', 'pano.jpg'], 60000);
  assert.equal(pano.status, 0, `magick-open pano.jpg: rc ${pano.status} ${pano.stderr}`);
  const panoSize = await bounded(['identify', '-format', '%w %h', 'pano.jpg'], 60000);
  assert.equal(panoSize.status, 0, `identify -format pano.jpg: rc ${panoSize.status} ${panoSize.stderr}`);
  assert.equal(panoSize.stdout, '18000 3000');
  const thumb = await bounded(['magick', 'pano.jpg', '-resize', '2000x', 'thumb.jpg'], 60000);
  assert.equal(thumb.status, 0, `magick pano.jpg -resize 2000x: rc ${thumb.status} ${thumb.stderr}`);
  assert.doesNotMatch(thumb.stderr, FATAL);
  assert.equal((await run(['identify', '-format', '%w %h', 'thumb.jpg'])).stdout, '2000 333');
  const tall = await bounded(['magick', '-size', '1000x20000', 'gradient:red-blue', '-resize', '10%', 'tall.png'], 60000);
  assert.equal(tall.status, 0, `1000x20000: rc ${tall.status} ${tall.stderr}`);
  assert.equal((await run(['identify', '-format', '%w %h', 'tall.png'])).stdout, '100 2000');

  const wide = ['-size', '70000x10', 'xc:white', '-resize', '10%'];
  const tabWide = await run(['magick', ...wide, 'wide-tab.png']);
  assert.equal(tabWide.status, 1, 'a 70000-wide canvas is over the tab policy');
  const lifted = await run(['magick-open', ...wide, 'wide-open.png']);
  assert.equal(lifted.status, 0, `magick-open: rc ${lifted.status} ${lifted.stderr}`);
  assert.equal((await run(['magick', 'identify', '-format', '%w %h', 'wide-open.png'])).stdout, '7000 1');
  const openList = limits((await run(['magick-open', '-list', 'resource'])).stdout);
  assert.notEqual(openList.Area, '64MP', 'magick-open reads policy-open');
  const envLifted = await run(['magick', ...wide, 'wide-env.png'], { MAGICK_CONFIGURE_PATH: open });
  assert.equal(envLifted.status, 0, `MAGICK_CONFIGURE_PATH=${open}: rc ${envLifted.status} ${envLifted.stderr}`);
  const envPol = await run(['magick', '-list', 'policy'], { MAGICK_CONFIGURE_PATH: open });
  assert.match(envPol.stdout, /Path: \S*\/etc\/ImageMagick-7-open\/policy\.xml/);
  console.log(`policy: 30000x30000 refused in ${huge.ms} ms, 70000x10 in ${long.ms} ms, 9000x9000 in ${area.ms} ms, resizes ${photo.ms}; 18000x3000 panorama: identify ${panoSize.ms} ms, thumbnail ${thumb.ms} ms; magick-open and MAGICK_CONFIGURE_PATH lift`);
}
