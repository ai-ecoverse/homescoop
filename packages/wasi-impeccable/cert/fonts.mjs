const responder = {
  toString: () => `(req) => {
    const u = new URL(req.url);
    const header = (name) => (req.headers.find(([k]) => k.toLowerCase() === name) ?? [])[1] ?? '';
    const browser = / Chrome\\/[0-9.]+ Safari\\/[0-9.]+$/.test(header('user-agent'));
    const face = (subset, style, weight, file, range) => '/* ' + subset + ' */\\n@font-face {\\n  font-family: \\'Space Grotesk\\';\\n  font-style: ' + style + ';\\n  font-weight: ' + weight + ';\\n  font-display: swap;\\n  src: url(https://fonts.gstatic.com/s/spacegrotesk/v1/' + file + ') format(\\'woff2\\');\\n  unicode-range: ' + range + ';\\n}\\n';
    if (u.host === 'fonts.googleapis.com' && u.pathname === '/css2') {
      const family = u.searchParams.get('family') ?? '';
      if (!browser) return { status: 200, headers: [['content-type', 'text/css']], body: "/* latin */\\n@font-face {\\n  font-family: 'Space Grotesk';\\n  font-style: normal;\\n  font-weight: 400;\\n  src: url(https://fonts.gstatic.com/s/spacegrotesk/v1/plain.ttf) format('truetype');\\n}\\n" };
      if (family === 'Space+Grotesk:wght@400;700' || family === 'Space Grotesk:wght@400;700') {
        return { status: 200, headers: [['content-type', 'text/css']], body:
          face('vietnamese', 'normal', '400', 'vi.woff2', 'U+0102-0103, U+1EA0-1EF9') +
          face('latin-ext', 'normal', '400', 'ext400.woff2', 'U+0100-02BA') +
          face('latin', 'normal', '400', 'latin400.woff2', 'U+0000-00FF') +
          face('latin-ext', 'normal', '700', 'ext700.woff2', 'U+0100-02BA') +
          face('latin', 'normal', '700', 'latin700.woff2', 'U+0000-00FF') };
      }
      if (family === 'Sora:wght@400;600') {
        return { status: 200, headers: [['content-type', 'text/css']], body:
          face('latin', 'normal', '400', 'sora-var.woff2', 'U+0000-00FF') +
          face('latin', 'normal', '600', 'sora-var.woff2', 'U+0000-00FF') };
      }
      return { status: 400, body: 'Bad Request' };
    }
    if (u.host === 'fonts.gstatic.com' && u.pathname.startsWith('/s/spacegrotesk/v1/')) {
      if (!browser) return { status: 403, body: 'forbidden' };
      return { status: 200, headers: [['content-type', 'font/woff2']], body: new TextEncoder().encode('wOF2 ' + u.pathname.split('/').pop()) };
    }
    return { status: 404, body: 'not mocked' };
  }`,
};

export default async function ({ run, write, read, assert, serve }) {
  await serve(responder);
  const H = '/home/impfont';
  const site = `${H}/site`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true}\n');
  await write(`${site.slice(1)}/assets/fonts/space-grotesk-700-latin.woff2`, 'kept\n');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 2000)}\n--- stderr\n${r.stderr.slice(0, 1500)}`;
  const imp = (args) => run(['impeccable', ...args], { cwd: site, env: { HOME: H, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1' } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const rule = (weight, name, range) => `@font-face {\n  font-family: "Space Grotesk";\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("assets/fonts/${name}") format("woff2");\n  unicode-range: ${range};\n}\n`;
  const TAIL = 'Paste these rules into your stylesheet; their paths are relative to the project root, so make them relative to the stylesheet if it lives elsewhere. Nothing else to fetch.\n';

  const fetched = await imp(['font-fetch', 'Space', 'Grotesk']);
  clean('font-fetch Space Grotesk', fetched);
  assert.equal(fetched.status, 0, show('font-fetch Space Grotesk', fetched));
  assert.equal(fetched.stderr, '', show('font-fetch Space Grotesk', fetched));
  assert.equal(fetched.stdout, [
    rule(400, 'space-grotesk-400-latin-ext.woff2', 'U+0100-02BA'),
    rule(400, 'space-grotesk-400-latin.woff2', 'U+0000-00FF'),
    rule(700, 'space-grotesk-700-latin-ext.woff2', 'U+0100-02BA'),
    rule(700, 'space-grotesk-700-latin.woff2', 'U+0000-00FF'),
    `\n4 files in assets/fonts. ${TAIL}`,
  ].join(''), show('font-fetch Space Grotesk', fetched));
  for (const [name, file] of [
    ['space-grotesk-400-latin-ext.woff2', 'ext400.woff2'],
    ['space-grotesk-400-latin.woff2', 'latin400.woff2'],
    ['space-grotesk-700-latin-ext.woff2', 'ext700.woff2'],
  ]) {
    assert.equal(await read(`${site}/assets/fonts/${name}`), `wOF2 ${file}`, name);
  }
  assert.equal(await read(`${site}/assets/fonts/space-grotesk-700-latin.woff2`), 'kept\n');
  assert.equal(await read(`${site}/assets/fonts/space-grotesk-400-vietnamese.woff2`), null);

  const variable = await imp(['font-fetch', 'Sora', '--weights', '600,400', '--out', 'static/type/']);
  clean('font-fetch Sora --weights 600,400 --out static/type/', variable);
  assert.equal(variable.status, 0, show('font-fetch Sora', variable));
  assert.equal(variable.stdout, [
    rule(400, 'sora-latin.woff2', 'U+0000-00FF').replace('Space Grotesk', 'Sora').replace('assets/fonts/', 'static/type/'),
    rule(600, 'sora-latin.woff2', 'U+0000-00FF').replace('Space Grotesk', 'Sora').replace('assets/fonts/', 'static/type/'),
    `\n1 files in static/type (a variable font: one file per subset serves every weight). ${TAIL}`,
  ].join(''), show('font-fetch Sora', variable));
  assert.equal(await read(`${site}/static/type/sora-latin.woff2`), 'wOF2 sora-var.woff2');

  const refusals = [
    [['font-fetch', 'Nope', 'Sans'], 'Google Fonts has no family named "Nope Sans" at those weights. Check the name at fonts.google.com.\n'],
    [['font-fetch', 'Sora', '--weights', '0,400'], '--weights takes numbers from 1 to 1000, like 400,700.\n'],
    [['font-fetch', 'Sora', '--out', '../elsewhere'], '--out must be a directory inside this project, like assets/fonts.\n'],
    [['font-fetch', 'Sora', '--out', '/tmp/fonts'], '--out must be a directory inside this project, like assets/fonts.\n'],
  ];
  for (const [args, message] of refusals) {
    const r = await imp(args);
    clean(args.join(' '), r);
    assert.equal(r.status, 1, show(args.join(' '), r));
    assert.equal(r.stdout, '', show(args.join(' '), r));
    assert.equal(r.stderr, message, show(args.join(' '), r));
  }
  assert.equal(await read(`${H}/elsewhere/sora-latin.woff2`), null);

  const usage = await imp(['font-fetch']);
  assert.equal(usage.status, 1, show('font-fetch', usage));
  assert.match(usage.stderr, /^Usage: impeccable font-fetch "<Family>" \[--weights 400,700\] \[--italic\] \[--out assets\/fonts\]$/m, show('font-fetch', usage));
}
