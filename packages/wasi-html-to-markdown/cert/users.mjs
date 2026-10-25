import { fixture } from '../test/goldens.mjs';

export default async function (ctx) {
  const { run, write, read, addUser, assert } = ctx;
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const md = fixture('tty.md');
  await write('/home/alice/web/tty.html', fixture('tty.html'));
  const setup = await run(['bash', '-c', [
    `chown -R ${alice.uid}:${alice.gid} /home/alice`,
    'chmod 700 /home/alice && chmod 600 /home/alice/web/tty.html',
    `mkdir -p /home/bob && chown ${bob.uid}:${bob.gid} /home/bob`,
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, `setup: ${out(setup)}`);

  let r = await run(['html-to-markdown', '--input', 'web/tty.html'], { user: 'alice', cwd: '/home/alice' });
  assert.equal(r.status, 0, out(r));
  assert.ok(r.stdout === md, `alice converts her own 0600 page: ${out(r)}`);
  r = await run(['bash', '-c', 'cat web/tty.html | html2markdown'], { user: 'alice', cwd: '/home/alice' });
  assert.ok(r.stdout === md, `alice pipes it: ${out(r)}`);
  r = await run(['bash', '-c', 'html-to-markdown --input web/tty.html --output web/tty.md && ls -ln web/tty.md'], { user: 'alice', cwd: '/home/alice' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, new RegExp(`^-rw-r--r-- 1 ${alice.uid} ${alice.gid} ${Buffer.byteLength(md) - 1} `), `--output is alice's: ${out(r)}`);

  r = await run(['html-to-markdown', '--input', '/home/alice/web/tty.html'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^\nerror: no files found matching pattern "\/home\/alice\/web\/tty\.html"\n/, out(r));
  r = await run(['bash', '-c', 'html-to-markdown < /home/alice/web/tty.html'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /\/home\/alice\/web\/tty\.html: Permission denied/);
  r = await run(['html-to-markdown', '--output', '/home/alice/web/bob.md'], { user: 'bob', cwd: '/home/bob', stdin: '<p>bob</p>' });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /^\nerror: mkdir \/home\/alice\/web: /, out(r));
  assert.equal(await read('/home/alice/web/bob.md'), null, 'bob wrote nothing into alice\'s home');
  r = await run(['bash', '-c', "printf '<p><b>bob</b></p>' | html-to-markdown --output mine.md && ls -ln mine.md && cat mine.md"], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, `-rw-r--r-- 1 ${bob.uid} ${bob.gid} 7 ${r.stdout.split(' ').slice(5, 8).join(' ')} mine.md\n**bob**`, out(r));
  r = await run(['html-to-markdown', '--input', '/home/alice/web/tty.html'], { cwd: '/' });
  assert.ok(r.stdout === md, `root reads alice's page: ${out(r)}`);
  console.log("users: alice converts, pipes and writes her own 0600 page; bob can't read it or write into her 0700 home; bob's own output is his");
}
