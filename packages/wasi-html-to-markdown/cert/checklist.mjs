import { cases, expected, fixture, largeHtml, matches, sha256 } from '../test/goldens.mjs';

const VERSION = 'html2markdown\n\nGitVersion:  2.5.2\nGitCommit:   290df46a279e3d7d9011dbbb199658dfcb5ec272\nBuildDate:   2026-06-07T12:48:53Z\n';
const USAGE = '\nerror: the html input should be piped into the cli\n\nHere is how you can use the CLI:\n\n    echo "<strong>important</strong>" | html2markdown\n\n';

export default async function (ctx) {
  const { run, write, read, serve, assert } = ctx;
  const cwd = '/home/docs';
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const page = fixture('tty.html');
  const md = fixture('tty.md');
  const tableMd = fixture('tty.table.md');

  for (const command of ['html-to-markdown', 'html2markdown']) {
    const r = await run([command, '--version']);
    assert.equal(r.status, 0, out(r));
    assert.equal(r.stdout, VERSION);
  }

  const body = new Function(`return () => ({ status: 200, headers: [['content-type', 'text/html; charset=utf-8']], body: ${JSON.stringify(page)} })`)();
  await serve(body);
  let r = await run(['bash', '-c', 'curl -sL http://nodejs.test/api/tty.html | html-to-markdown'], { cwd: '/home' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stderr, '');
  assert.ok(r.stdout === md, `curl | html-to-markdown differs from native html2markdown (tty.md): ${out(r)}`);
  r = await run(['bash', '-c', 'curl -sL http://nodejs.test/api/tty.html | html2markdown --plugin-table > /tmp/tty.md && wc -l < /tmp/tty.md'], { cwd: '/home' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout.trim(), String(tableMd.split('\n').length - 1));
  assert.ok((await read('/tmp/tty.md')) === tableMd, 'curl | html2markdown --plugin-table differs from native (tty.table.md)');

  for (const c of cases) {
    r = await run(['html-to-markdown', ...c.args], { stdin: c.input(), cwd: '/home' });
    assert.equal(r.status, 0, `${c.name}: ${out(r)}`);
    assert.ok(matches(c, r.stdout), `${c.name} on stdin differs from native html2markdown: ${out(r)}`);
  }
  assert.ok(tableMd.includes('| Version | Changes '), 'tty.table.md has the history tables');
  assert.ok(md.includes('```js\n') && md.includes('[Node.js](/ "Go back to the home page")') && md.includes('\n### Class: `tty.ReadStream`') && md.includes('\n- '), 'tty.md has code, links, headings and lists');
  assert.ok(!md.includes('<script') && !md.includes('function()'), 'scripts are dropped');

  await write(`${cwd}/tty.html`, page);
  await write(`${cwd}/large.html`, largeHtml());
  r = await run(['html-to-markdown', '--input', 'tty.html'], { cwd });
  assert.equal(r.status, 0, out(r));
  assert.ok(r.stdout === md, `--input tty.html: ${out(r)}`);
  r = await run(['html2markdown', '--input', `${cwd}/tty.html`, '--plugin-table'], { cwd: '/tmp' });
  assert.ok(r.stdout === tableMd, `--input with an absolute path: ${out(r)}`);
  r = await run(['bash', '-c', 'html-to-markdown < large.html | sha256sum'], { cwd });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, `${expected(cases.find((c) => c.name === 'large')).sha256}  -\n`);
  r = await run(['html-to-markdown', '--input', 'tty.html', '--output', 'out/tty.md'], { cwd });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, '');
  assert.ok((await read(`${cwd}/out/tty.md`)) === md.slice(0, -1), '--output writes the Markdown without the newline stdout adds');
  r = await run(['html-to-markdown', '--input', 'tty.html', '--output', 'out/tty.md'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /out\/tty\.md.*already exists/s);
  r = await run(['html-to-markdown', '--input', '*.html', '--output', 'all/'], { cwd });
  assert.equal(r.status, 0, out(r));
  assert.ok((await read(`${cwd}/all/tty.md`)) === md.slice(0, -1), 'a glob to a directory');
  assert.equal(sha256(`${await read(`${cwd}/all/large.md`)}\n`), expected(cases.find((c) => c.name === 'large')).sha256);

  r = await run(['html-to-markdown', 'tty.html'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '\nerror: unknown arguments: tty.html\n\nHere is how you can use the CLI:\n\n    echo "<strong>important</strong>" | html2markdown\n\n');
  r = await run(['html-to-markdown', '--input', 'missing.html'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /^\nerror: no files found matching pattern "missing\.html"\n/);
  r = await run(['html-to-markdown'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stderr, USAGE, 'no stdin: the usage error, without colour codes');
  r = await run(['bash', '-c', 'html-to-markdown < /dev/null'], { cwd });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stderr, USAGE);
  r = await run(['html-to-markdown', '-b', '*'], { stdin: '<ul><li>a</ul>', cwd });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stderr, '\nerror: unknown flag: -b\n\n');
  r = await run(['html-to-markdown', '--exclude-selector', 'footer,nav', '--domain', 'https://nodejs.org/api/'], { stdin: '<nav>menu</nav><p>See <a href="fs.html">fs</a>.</p><footer>bye</footer>', cwd });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'See [fs](https://nodejs.org/api/fs.html).\n');
  console.log(`checklist: ${cases.length} stdin cases and curl | html-to-markdown match native html2markdown byte for byte; --input, --output, globs and the errors as upstream`);
}
