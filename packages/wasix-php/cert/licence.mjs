/**
 * package.json's license is PHP-3.01 AND Zend-2.0, and package/LICENSE has
 * both texts: PHP's LICENSE and Zend/LICENSE. licenses/ has the texts of the
 * libraries PHP bundles; patches/ and SOURCES.md are shipped.
 */
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export default async function (ctx) {
  const { assert } = ctx;
  const dir = `/node_modules/${ctx.npmName}`;
  const pkg = JSON.parse((await ctx.read(`${dir}/package.json`)) ?? '{}');
  assert.equal(pkg.license, 'PHP-3.01 AND Zend-2.0');
  const licence = norm((await ctx.read(`${dir}/LICENSE`)) ?? '');
  for (const text of ['The PHP License, version 3.01', 'The Zend Engine License, Version 2.00']) assert.ok(licence.includes(text), `package/LICENSE lacks "${text}"`);
  for (const f of ['php-LICENSE', 'zend-LICENSE', 'libmbfl-LICENSE', 'libbcmath-LICENSE', 'lexbor-LICENSE', 'uriparser-COPYING', 'libxml2-Copyright', 'php-README.REDIST.BINS']) {
    assert.ok(((await ctx.read(`${dir}/licenses/${f}`)) ?? '').length > 100, `licenses/${f}`);
  }
  const sources = (await ctx.read(`${dir}/SOURCES.md`)) ?? '';
  assert.match(sources, /php-8\.5\.12\.tar\.xz\]\(https:\/\/www\.php\.net\/distributions\/php-8\.5\.12\.tar\.xz\) \| `08bc2eba/);
  for (const p of ['0001-configure-wasi-host', '0002-zend-fibers-unavailable-wasi', '0003-zend-setjmp-wasi', '0004-zend-alloc-chunks-wasi', '0005-tmpdir-wasi', '0006-fd-wrapper-dtablesize-wasi', '0007-http-wrapper-env-proxy-wasi', '0008-max-execution-time-real-timer-wasi', '0009-zend-call-stack-wasi']) {
    assert.match((await ctx.read(`${dir}/patches/${p}.patch`)) ?? '', /^--- a\//m, `patches/${p}.patch`);
  }
  console.log(`licence: ${pkg.license}; LICENSE has the PHP and Zend texts; licenses/, SOURCES.md and patches/ are shipped`);
}
