/**
 * Requires chains deeper than 256 levels (homescoop#532). pkgconf 3.0 caps
 * dependency traversal at 256 levels by default (NEWS: against stack
 * exhaustion); past that, --libs and --cflags exit 0 and leave the deeper
 * modules out, with nothing on stderr. pkgconf 2.5.1 followed the whole
 * chain. --maximum-traverse-depth=-1 or PKG_CONFIG_MAXIMUM_TRAVERSE_DEPTH=-1
 * lifts the cap. This pins upstream's behaviour as the README describes it;
 * the package doesn't patch it (no upstream change as of 3.0.9).
 */
const DEPTH = 260;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (let i = 0; i < DEPTH; i++) {
    const req = i + 1 < DEPTH ? `Requires: d${i + 1}\n` : '';
    await write(`home/deep/d${i}.pc`, `Name: d${i}\nDescription: chain level ${i}\nVersion: 1.0\n${req}Libs: -ld${i}\nCflags: -DD${i}\n`);
  }
  const env = { PKG_CONFIG_PATH: '/home/deep', PKG_CONFIG_LIBDIR: '/home/deep-none' };
  async function pc(args, extra = {}) {
    const r = await run(['pkg-config', ...args], { cwd: '/home', env: { ...env, ...extra } });
    const what = `pkg-config ${args.join(' ')}${Object.keys(extra).length ? ` (${JSON.stringify(extra)})` : ''}`;
    assert.equal(r.status, 0, `${what}: exit ${r.status}: ${r.stderr}`);
    return { flags: r.stdout.trim().split(/\s+/), stderr: r.stderr, what };
  }
  const levels = (n) => Array.from({ length: n }, (_, i) => `-ld${i}`);

  // The default: 256 levels (d0 … d255), exit 0, no warning.
  const def = await pc(['--libs', 'd0']);
  assert.deepEqual(def.flags, levels(256), `${def.what}: the default traversal depth is 256 levels: ${def.flags.slice(-3).join(' ')} (${def.flags.length} flags)`);
  assert.equal(def.stderr, '', `${def.what}: the cut is silent: ${def.stderr}`);
  const cf = await pc(['--cflags', 'd0']);
  assert.equal(cf.flags.length, 256, `${cf.what}: --cflags stops at 256 levels too: ${cf.flags.length}`);
  assert.equal(cf.flags.at(-1), '-DD255', `${cf.what}: ${cf.flags.at(-1)}`);

  // The way back: the whole chain.
  for (const [args, extra] of [
    [['--maximum-traverse-depth=-1', '--libs', 'd0'], {}],
    [['--libs', 'd0'], { PKG_CONFIG_MAXIMUM_TRAVERSE_DEPTH: '-1' }],
    [['--maximum-traverse-depth=300', '--libs', 'd0'], {}],
  ]) {
    const r = await pc(args, extra);
    assert.deepEqual(r.flags, levels(DEPTH), `${r.what}: all ${DEPTH} levels: ${r.flags.slice(-3).join(' ')} (${r.flags.length} flags)`);
  }
  console.log(`depth: a ${DEPTH}-level Requires chain gives 256 levels of --libs/--cflags by default, silently; --maximum-traverse-depth=-1, =300 and PKG_CONFIG_MAXIMUM_TRAVERSE_DEPTH=-1 give all ${DEPTH}`);
}
