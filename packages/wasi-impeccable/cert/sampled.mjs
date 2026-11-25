import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const recipe = readFileSync(new URL('../recipe.yaml', import.meta.url), 'utf8');
const VERSION = recipe.match(/^version: "([^"]+)"$/m)[1];

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes) {
  let x = 0xffffffff;
  for (const b of bytes) x = TABLE[(x ^ b) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgba).flat())]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fnv64(text) {
  let hash = 0xcbf29ce484222325n;
  for (const b of Buffer.from(text)) {
    hash ^= BigInt(b);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export default async function ({ run, write, read, assert }) {
  const H = '/home/impsample';
  const site = `${H}/site`;
  const page = (image) => `<!doctype html><html><head><title>Hero</title><style>.hero { background: url(${image}); } p { color: #fdfdfd; }</style></head><body><div class=hero><p>White copy on the image</p></div></body></html>\n`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true}\n');
  await write(`${site.slice(1)}/light.png`, png(320, 200, [243, 239, 230, 255]));
  await write(`${site.slice(1)}/dark.png`, png(320, 200, [26, 24, 22, 255]));
  await write(`${site.slice(1)}/light.html`, page('light.png'));
  await write(`${site.slice(1)}/dark.html`, page('dark.png'));
  await write(`${site.slice(1)}/card.html`, `<!doctype html>
<html lang="en">
<body>
  <!-- impeccable-disable side-tab -- the stripe is the brand mark on this export -->
  <!-- impeccable-disable bounce-easing: the spring was removed in review -->
  <div style="border-left: 4px solid #ff0000; border-radius: 10px">Exported brand card</div>
</body>
</html>
`);
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 1500)}\n--- stderr\n${r.stderr.slice(0, 1500)}`;
  const imp = (args) => run(['impeccable', ...args], { cwd: site, env: { HOME: H, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1' } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const SAMPLED = 'sampled (coarse) 1.1:1 (need 4.5:1) — text #fdfdfd on light.png; p90 of 36 samples, median 1.1:1';

  const light = await imp(['detect', '--json', 'light.html']);
  clean('detect --json light.html', light);
  assert.equal(light.status, 2, show('detect --json light.html', light));
  const found = JSON.parse(light.stdout);
  assert.deepEqual(found.map((f) => [f.antipattern, f.file, f.snippet]), [['low-contrast', `${site}/light.html`, SAMPLED]], show('detect --json light.html', light));

  const entry = JSON.parse((await read(`${H}/.impeccable/sample-cache/${fnv64(`${site}/light.png`)}.json`)) ?? 'null');
  assert.ok(entry, show('the sample cache entry for light.png', light));
  assert.equal(entry.w, 320, JSON.stringify(entry));
  assert.equal(entry.h, 200, JSON.stringify(entry));
  assert.equal(entry.grid, 6, JSON.stringify(entry));
  assert.equal(entry.len, png(320, 200, [243, 239, 230, 255]).length, JSON.stringify(entry));
  const samples = Buffer.from(entry.samples, 'base64');
  assert.equal(samples.length, 36 * 4, JSON.stringify(entry));
  for (let i = 0; i < 36; i++) assert.deepEqual([...samples.subarray(i * 4, i * 4 + 4)], [243, 239, 230, 255], JSON.stringify(entry));

  const again = await imp(['detect', 'light.html']);
  clean('detect light.html (cached)', again);
  assert.equal(again.status, 2, show('detect light.html (cached)', again));
  assert.ok(again.stderr.includes(`  [low-contrast] ${SAMPLED}\n`), show('detect light.html (cached)', again));
  assert.match(again.stderr, /^1 anti-pattern found\.$/m, show('detect light.html (cached)', again));

  const dark = await imp(['detect', '--json', 'dark.html']);
  clean('detect --json dark.html', dark);
  assert.equal(dark.status, 0, show('detect --json dark.html', dark));
  assert.deepEqual(JSON.parse(dark.stdout), [], show('detect --json dark.html', dark));

  const sarif = await imp(['detect', '--sarif', 'light.html']);
  clean('detect --sarif light.html', sarif);
  assert.equal(sarif.status, 2, show('detect --sarif light.html', sarif));
  const log = JSON.parse(sarif.stdout);
  assert.equal(log.version, '2.1.0', show('detect --sarif light.html', sarif));
  assert.equal(log.runs.length, 1, show('detect --sarif light.html', sarif));
  assert.equal(log.runs[0].tool.driver.name, 'impeccable', show('detect --sarif light.html', sarif));
  assert.equal(log.runs[0].tool.driver.version, VERSION, show('detect --sarif light.html', sarif));
  assert.deepEqual(log.runs[0].tool.driver.rules.map((r) => r.id), ['low-contrast'], show('detect --sarif light.html', sarif));
  assert.deepEqual(log.runs[0].invocations, [{ executionSuccessful: true }], show('detect --sarif light.html', sarif));
  assert.equal(log.runs[0].results.length, 1, show('detect --sarif light.html', sarif));
  const [result] = log.runs[0].results;
  assert.equal(result.ruleId, 'low-contrast', show('detect --sarif light.html', sarif));
  assert.equal(result.level, 'warning', show('detect --sarif light.html', sarif));
  assert.ok(result.message.text.startsWith(`${SAMPLED}\n`), show('detect --sarif light.html', sarif));
  assert.deepEqual(result.locations[0].physicalLocation.artifactLocation, { uri: 'light.html', uriBaseId: '%SRCROOT%' }, show('detect --sarif light.html', sarif));

  const quiet = await imp(['detect', '--sarif', 'dark.html']);
  clean('detect --sarif dark.html', quiet);
  assert.equal(quiet.status, 0, show('detect --sarif dark.html', quiet));
  assert.deepEqual(JSON.parse(quiet.stdout).runs[0].results, [], show('detect --sarif dark.html', quiet));

  const both = await imp(['detect', '--sarif', '--json', 'light.html']);
  assert.equal(both.status, 1, show('detect --sarif --json light.html', both));
  assert.equal(both.stdout, '', show('detect --sarif --json light.html', both));
  assert.match(both.stderr, /^Error: --sarif cannot be used with --json$/m, show('detect --sarif --json light.html', both));

  const waived = await imp(['detect', '--json', 'card.html']);
  clean('detect --json card.html', waived);
  assert.equal(waived.status, 0, show('detect --json card.html', waived));
  assert.deepEqual(JSON.parse(waived.stdout), [], show('detect --json card.html', waived));

  const unused = await imp(['detect', '--json', '--report-unused-ignores', 'card.html']);
  clean('detect --json --report-unused-ignores card.html', unused);
  assert.equal(unused.status, 2, show('detect --json --report-unused-ignores card.html', unused));
  assert.deepEqual(JSON.parse(unused.stdout).map((f) => [f.antipattern, f.file, f.line, f.snippet]), [
    ['unused-ignore', `${site}/card.html`, 5, 'impeccable-disable bounce-easing'],
  ], show('detect --json --report-unused-ignores card.html', unused));

  const told = await imp(['detect', '--report-unused-ignores', 'card.html']);
  clean('detect --report-unused-ignores card.html', told);
  assert.equal(told.status, 2, show('detect --report-unused-ignores card.html', told));
  assert.match(told.stderr, /^ {2}line 5: \[unused-ignore\] impeccable-disable bounce-easing$/m, show('detect --report-unused-ignores card.html', told));
  assert.match(told.stderr, /^1 unused inline ignore found\.$/m, show('detect --report-unused-ignores card.html', told));
}
