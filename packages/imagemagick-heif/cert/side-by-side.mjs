import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pagePut } from '../../libheif/cert/lib/page.mjs';

const PLAIN = '@ai-ecoverse/wasm-imagemagick';

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)];
  });
}

export default async function sideBySide(ctx) {
  const { assert, page } = ctx;
  const nm = process.env.HOMESCOOP_CERT_NODE_MODULES;
  assert.ok(nm, 'HOMESCOOP_CERT_NODE_MODULES (needsInstall has the plain package)');
  const root = join(nm, PLAIN);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  for (const f of files(root)) {
    await page.evaluate(pagePut, `node_modules/${PLAIN}/${f}`, readFileSync(join(root, f)).toString('base64'));
  }
  const winner = {};
  for (const cmd of ['magick', 'convert', 'identify', 'mogrify']) {
    const r = await ctx.run([cmd, '-version'], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${cmd} -version with both installed: rc ${r.status} ${r.stderr}`);
    winner[cmd] = /Delegates \(built-in\):.*\bheic\b/.test(r.stdout) ? 'wasm-imagemagick-heif' : 'wasm-imagemagick';
  }
  const providers = [...new Set(Object.values(winner))];
  assert.equal(providers.length, 1, `one package provides all four shared commands: ${JSON.stringify(winner)}`);
  assert.equal(
    providers[0],
    'wasm-imagemagick',
    `recorded behaviour changed: with wasm-imagemagick ${version} installed next to wasm-imagemagick-heif, ${providers[0]} now provides the commands (slicc-kernel#635 honours "replaces"); update this case and the READMEs' Switching sections`,
  );
  const open = await ctx.run(['magick-open', '-version'], { cwd: '/tmp' });
  assert.match(open.stdout, /\bheic\b/, 'magick-open (not in wasm-imagemagick 7.1.2-32-4) still comes from this package');
  console.log(`side-by-side: with ${PLAIN} ${version} also installed, magick, convert, identify and mogrify come from wasm-imagemagick (no heic; magick-open, which -32-4 lacks, from this package), without a warning; "replaces" is not honoured by this kernel yet (slicc-kernel#635)`);
}
