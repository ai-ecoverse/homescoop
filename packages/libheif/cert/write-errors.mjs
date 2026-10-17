import { fixture } from './lib/fixtures.mjs';
import { pagePut, pageReadB64 } from './lib/page.mjs';

const DIR = 'home/heifw';
const CWD = `/${DIR}`;
const FATAL = /RuntimeError|Aborted|unreachable|memory access out of bounds|wasm trap/i;
const IN = 'rainbow-451x461.heic';

export default async function writeErrors(ctx) {
  const { assert, page } = ctx;
  await page.evaluate(pagePut, `${DIR}/${IN}`, Buffer.from(await fixture(IN)).toString('base64'));
  const run = (argv, o = {}) => ctx.run(argv, { cwd: CWD, ...o });
  await page.evaluate(pagePut, `${DIR}/adir.png/keep`, Buffer.from('x').toString('base64'));
  const exists = async (p) => (await page.evaluate(pageReadB64, p)) !== null;

  for (const tool of ['heif-convert', 'heif-dec']) {
    const ok = await run([tool, IN, `${tool}-ok.png`]);
    assert.equal(ok.status, 0, `${tool} ${IN} ${tool}-ok.png: ${ok.stderr}`);
    assert.match(ok.stdout, new RegExp(`Written to ${tool}-ok\\.png`));
    for (const [what, out] of [['a missing directory', 'nodir/x.png'], ['a directory in the way', 'adir.png']]) {
      const r = await run([tool, IN, out]);
      assert.notEqual(r.status, 0, `${tool} into ${what} (${out}) must fail, not exit 0 (homescoop#923): ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /could not write image/, `${tool} ${out}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, FATAL, `${tool} ${out}: no trap`);
      assert.doesNotMatch(r.stdout, /Written to/, `${tool} ${out}: ${r.stdout}`);
    }
    const jpg = await run([tool, '-q', '80', IN, 'nodir/x.jpg']);
    assert.notEqual(jpg.status, 0, `${tool} JPEG into a missing directory must fail: ${jpg.stderr}`);
  }
  assert.equal(await exists(`${DIR}/nodir/x.png`), false, 'nothing created nodir/x.png');

  if (ctx.users === 'enforce') {
    await ctx.addUser({ name: 'heifw' });
    const r = await run(['heif-convert', IN, '/etc/heifw.png'], { user: 'heifw' });
    assert.notEqual(r.status, 0, `heif-convert into /etc as a non-root user must fail: ${r.stderr}`);
    assert.match(r.stderr, /could not write image/);
    assert.equal(await exists('etc/heifw.png'), false, '/etc/heifw.png was not written');
  }
}
