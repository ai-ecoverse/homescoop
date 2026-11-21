export default async function ({ run, write, assert }) {
  const H = '/home/impfound';
  const site = `${H}/site`;
  const token = ['ghp', 'R8x2Kq9LmZ4vT7wN1pB6sD3fH5jY0cE2gA8u'].join('_');
  const dirty = `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.hero { background: linear-gradient(135deg, #667eea, #764ba2); }
</style></head><body>
<div class="hero"><h1>Hello</h1><p style="color:#999">gray on purple</p></div>
</body></html>
`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true,"dependencies":{"left-pad":"1.3.0"},"scripts":{"test":"node --test"}}\n');
  await write(`${site.slice(1)}/index.html`, dirty);
  await write(`${site.slice(1)}/src/config.js`, `export const region = 'eu';\nexport const token = '${token}';\n`);
  await write(`${site.slice(1)}/src/big.js`, Array.from({ length: 1200 }, (_, i) => `export const v${i} = ${i};\n`).join(''));
  await write(
    `${site.slice(1)}/.github/workflows/ci.yml`,
    'on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n',
  );
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 1200)}\n--- stderr\n${r.stderr.slice(0, 600)}`;
  const imp = (args, cwd) => run(['impeccable', ...args], { cwd, env: { HOME: H } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));

  const json = await imp(['foundations', '--json'], site);
  assert.equal(json.status, 0, show('foundations --json', json));
  clean('foundations --json', json);
  const body = JSON.parse(json.stdout);
  assert.equal(body.next, 'secrets-out-of-repo', show('foundations --json', json));
  assert.equal(body.items['secrets-out-of-repo'], 'failing', show('foundations --json', json));
  assert.equal(body.items['no-giant-files'], 'failing', show('foundations --json', json));
  assert.equal(body.items['dependency-scanning'], 'failing', show('foundations --json', json));
  assert.equal(body.items['ci-runs-tests'], 'checked', show('foundations --json', json));
  assert.equal(body.items['no-generic-ai-patterns'], 'failing', show('foundations --json', json));
  for (const [id, state] of Object.entries(body.items)) {
    assert.ok(['checked', 'failing'].includes(state), `${id}: ${state}\n${show('foundations --json', json)}`);
  }
  assert.ok(!json.stdout.includes(token), show('foundations --json', json));

  const text = await imp(['foundations', 'site'], H);
  assert.equal(text.status, 0, show('foundations site', text));
  clean('foundations site', text);
  assert.match(text.stdout, /^Foundations: \d+ of \d+ in place$/m, show('foundations site', text));
  assert.match(text.stdout, /^Next up: No secrets in the repository$/m, show('foundations site', text));
  assert.match(text.stdout, /^  src\/config\.js:2 \(GitHub token\)$/m, show('foundations site', text));
  assert.match(text.stdout, /^  Ask your agent: \/impeccable foundations secrets-out-of-repo$/m, show('foundations site', text));
  assert.match(text.stdout, /^✗ No giant files  \(no-giant-files\)$/m, show('foundations site', text));
  assert.match(text.stdout, /^✗ Dependency scanning  \(dependency-scanning\)$/m, show('foundations site', text));
  assert.match(text.stdout, /^✓ CI runs the tests$/m, show('foundations site', text));
  assert.ok(!text.stdout.includes(token), show('foundations site', text));

  const missing = await imp(['foundations', 'nowhere'], H);
  assert.equal(missing.status, 1, show('foundations nowhere', missing));
  assert.match(missing.stderr, new RegExp(`^No such folder: ${H}/nowhere$`, 'm'), show('foundations nowhere', missing));

  const mk = await run(['mkdir', '-p', `${H}/empty`], { cwd: H });
  assert.equal(mk.status, 0, show('mkdir', mk));
  const empty = await imp(['foundations'], `${H}/empty`);
  assert.equal(empty.status, 0, show('foundations in an empty folder', empty));
  assert.match(empty.stdout, /^Nothing to check yet: this folder has no files\./m, show('foundations in an empty folder', empty));

  const ls = await run(['ls', '-A', H], { cwd: H });
  assert.equal(ls.status, 0, show('ls', ls));
  assert.ok(!/\.impeccable/.test(ls.stdout), show('ls after foundations', ls));
}
