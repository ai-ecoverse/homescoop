export default async function version(ctx) {
  const { assert } = ctx;
  const v = await ctx.run(['websocat', '--version'], { cwd: '/home' });
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout, 'websocat 4.0.0-alpha3\n');
  const notices = await ctx.read(`/node_modules/${ctx.npmName}/THIRD-PARTY-NOTICES.md`);
  assert.ok(notices, 'THIRD-PARTY-NOTICES.md is installed');
  for (const re of [/^## tokio 1\.47\.0\+wasix\.1 \(/m, /^## rustls 0\.23\.\d+ \(/m, /^## ring 0\.17\.\d+\+wasix\.1 \(/m, /^## webpki-roots \d/m, /^## mio 1\.0\.3\+wasix\.1, the wasix-org fork/m, /^## Rust standard library, wasix-org\/rust v2026-09-18\.1\+rust-1\.97/m, /^## @ai-ecoverse\/wasix-sysroot 2025\.9\.30-\d+ /m]) {
    assert.match(notices, re);
  }
}
