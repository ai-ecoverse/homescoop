export default async function ({ run, write, read, assert }) {
  const H = '/home/impwire';
  const site = `${H}/site`;
  const page = (field) => `<!doctype html>
<html><head><title>Sign up</title><script src="/app.js"></script></head>
<body>
<h1>${field.heading}</h1>
<a href="/terms">Terms</a>
<form action="/signup" method="post" id="signup">
<label for="email">Email</label>
<input id="email" name="${field.name}" type="email" required${field.hook ? ' data-testid="email-field"' : ''}>
<button type="submit" onclick="track('signup')">Sign up</button>
</form>
<img src="logo.png" alt="Logo">
</body></html>
`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true}\n');
  await write(`${site.slice(1)}/index.html`, page({ heading: 'Join', name: 'email', hook: true }));
  await write(`${site.slice(1)}/other.html`, '<!doctype html><html><body><a href="/">Home</a></body></html>\n');
  await write(`${site.slice(1)}/pages/about.html`, '<!doctype html><html><body><h2>About</h2><a href="/">Home</a><button type="button" id="more">More</button></body></html>\n');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 1200)}\n--- stderr\n${r.stderr.slice(0, 1200)}`;
  const imp = (args, cwd = site) => run(['impeccable', ...args], { cwd, env: { HOME: H, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1' } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const inv = /^\.impeccable\/wiring\/index-html-[0-9a-f]{8}\.json$/;

  const before = await imp(['detect', '--before', 'index.html']);
  assert.equal(before.status, 0, show('detect --before index.html', before));
  clean('detect --before index.html', before);
  assert.equal(before.stdout, '', show('detect --before index.html', before));
  const saved = /^Saved the wiring of index\.html to (\S+) \(10 wiring items, 2 content items\)\.$/m.exec(before.stderr);
  assert.ok(saved && inv.test(saved[1]), show('detect --before index.html', before));
  const file = JSON.parse(await read(`${site}/${saved[1]}`));
  assert.equal(file.version, 1, JSON.stringify(file));
  assert.equal(file.target, 'index.html', JSON.stringify(file));
  assert.deepEqual(file.wiring, [
    'button type="submit"',
    'field input name="email" type="email" required',
    'form action="/signup" method="post"',
    file.wiring.find((w) => /^handler button onclick #[0-9a-f]{8}$/.test(w)),
    'id "email"',
    'id "signup"',
    'label for="email"',
    'link href="/terms"',
    'script src="/app.js"',
    'test-hook data-testid="email-field"',
  ], JSON.stringify(file));
  assert.deepEqual(file.content, ['heading h1 "Join"', 'image alt="Logo"'], JSON.stringify(file));
  assert.match(await read(`${site}/.impeccable/wiring/.gitignore`), /^\*$/m);

  const kept = await imp(['detect', '--kept', 'index.html']);
  assert.equal(kept.status, 0, show('detect --kept index.html (unchanged)', kept));
  clean('detect --kept index.html (unchanged)', kept);
  assert.match(kept.stderr, /^index\.html: wiring kept \(10 items\)\.$/m, show('detect --kept index.html (unchanged)', kept));
  assert.match(kept.stderr, /^Wiring kept in 1 file\.$/m, show('detect --kept index.html (unchanged)', kept));

  await write(`${site.slice(1)}/index.html`, page({ heading: 'Join us', name: 'mail', hook: false }));
  const lost = await imp(['detect', '--kept', 'index.html']);
  assert.equal(lost.status, 1, show('detect --kept index.html (field renamed, test hook dropped)', lost));
  clean('detect --kept index.html', lost);
  assert.match(lost.stderr, /^index\.html: 2 wiring items missing of 10, 1 new\.$/m, show('detect --kept', lost));
  assert.match(lost.stderr, /^ {2}MISSING {2}field input name="email" type="email" required$/m, show('detect --kept', lost));
  assert.match(lost.stderr, /^ {2}MISSING {2}test-hook data-testid="email-field"$/m, show('detect --kept', lost));
  assert.match(lost.stderr, /^ {2}NEW {6}field input name="mail" type="email" required$/m, show('detect --kept', lost));
  assert.match(lost.stderr, /^ {4}gone {3}heading h1 "Join"$/m, show('detect --kept', lost));
  assert.match(lost.stderr, /^Wiring check failed: 2 items missing in 1 of 1 file\.$/m, show('detect --kept', lost));

  const json = await imp(['detect', '--kept', '--json', 'index.html', 'other.html']);
  assert.equal(json.status, 2, show('detect --kept --json index.html other.html', json));
  clean('detect --kept --json', json);
  const body = JSON.parse(json.stdout);
  assert.equal(body.mode, 'kept', show('detect --kept --json', json));
  assert.equal(body.ok, false, show('detect --kept --json', json));
  assert.equal(body.targets.length, 2, show('detect --kept --json', json));
  const [one, two] = body.targets;
  assert.equal(one.file, 'index.html', show('detect --kept --json', json));
  assert.equal(one.status, 'missing', show('detect --kept --json', json));
  assert.deepEqual(one.wiring, { before: 10, after: 9 }, show('detect --kept --json', json));
  assert.deepEqual(one.missing, ['field input name="email" type="email" required', 'test-hook data-testid="email-field"'], show('detect --kept --json', json));
  assert.deepEqual(one.new, ['field input name="mail" type="email" required'], show('detect --kept --json', json));
  assert.deepEqual(one.content, { gone: ['heading h1 "Join"'], new: ['heading h1 "Join us"'] }, show('detect --kept --json', json));
  assert.equal(two.file, 'other.html', show('detect --kept --json', json));
  assert.equal(two.status, 'no-inventory', show('detect --kept --json', json));
  assert.equal(two.error, 'no saved wiring for other.html; run detect --before other.html first', show('detect --kept --json', json));

  const sub = await imp(['detect', '--before', 'pages/about.html']);
  assert.equal(sub.status, 0, show('detect --before pages/about.html', sub));
  assert.match(sub.stderr, /^Saved the wiring of pages\/about\.html to \.impeccable\/wiring\/pages-about-html-[0-9a-f]{8}\.json \(3 wiring items, 1 content item\)\.$/m, show('detect --before pages/about.html', sub));
  const below = await imp(['detect', '--kept', 'about.html'], `${site}/pages`);
  assert.equal(below.status, 0, show('detect --kept about.html from site/pages', below));
  assert.match(below.stderr, /^pages\/about\.html: wiring kept \(3 items\)\.$/m, show('detect --kept about.html from site/pages', below));
  const nested = await run(['ls', '-A', `${site}/pages`], { cwd: site });
  assert.equal(nested.status, 0, show('ls pages', nested));
  assert.deepEqual(nested.stdout.split('\n').filter(Boolean), ['about.html'], show('ls pages', nested));

  for (const [args, message] of [
    [['detect', '--before', '--kept', 'index.html'], 'Error: --before works on local HTML files and cannot be used with --kept'],
    [['detect', '--before'], 'Error: --before needs one or more local .html files, e.g. detect --before index.html'],
    [['detect', '--changed', 'index.html'], 'Error: --changed scans the files git reports as changed and takes no file, URL, or --cdp targets'],
    [['detect', '--json', '--changed'], 'Error: --changed reads the changed files from git, and this directory is not inside a git work tree. Pass the files or directories to scan instead.'],
  ]) {
    const label = args.join(' ');
    const r = await imp(args);
    assert.equal(r.status, 1, show(label, r));
    clean(label, r);
    assert.ok(r.stderr.split('\n').includes(message), show(label, r));
    assert.equal(r.stdout, '', show(label, r));
  }

  const motion = await imp(['motion-capture', 'index.html']);
  assert.equal(motion.status, 1, show('motion-capture index.html', motion));
  clean('motion-capture index.html', motion);
  assert.match(motion.stderr, /^impeccable motion-capture: needs browser capture; not available in this build yet$/m, show('motion-capture index.html', motion));
  assert.equal(motion.stdout, '', show('motion-capture index.html', motion));

  const home = await run(['ls', '-A', H], { cwd: site });
  assert.equal(home.status, 0, show('ls home', home));
  assert.deepEqual(home.stdout.split('\n').filter(Boolean), ['site'], show('ls home', home));
}
