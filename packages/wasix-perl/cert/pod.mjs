/**
 * pod2usage from a command's own file (homescoop#491): pod2man and
 * pod2text --help read their usage POD from $0, the command's path. Up to
 * slicc-kernel 1.106.1 that was a 0-byte /usr/bin stub (slicc-kernel#762),
 * so --help printed nothing; from 1.106.2 (the cert kernel) the /usr/bin
 * entry is the script. Also: every script command's /usr/bin entry is a
 * readable, non-empty file.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const [cmd, want] of [['pod2man', /^Usage:\s+pod2man \[/m], ['pod2text', /^Usage:\s+pod2text \[/m]]) {
    const r = await run([cmd, '--help'], { cwd: '/tmp' });
    assert.match(`${r.stdout}${r.stderr}`, want, `${cmd} --help: rc=${r.status}\n${r.stdout}${r.stderr}`);
  }
  const scripts = Object.entries(ctx.installed?.[0]?.slicc?.commands ?? {}).filter(([, c]) => c.script).map(([n]) => n);
  assert.ok(scripts.includes('pod2man') && scripts.includes('prove'), `script commands: ${scripts.join(' ')}`);
  const r = await run(['bash', '-c', scripts.map((n) => `test -s /usr/bin/${n} && test -r /usr/bin/${n} || echo "empty ${n}"`).join('; ') + '; echo done'], { cwd: '/tmp' });
  assert.equal(r.stdout, 'done\n', `script commands whose /usr/bin entry is empty or unreadable: ${r.stdout}${r.stderr}`);
  console.log(`pod: pod2man and pod2text --help print their usage; ${scripts.length} script commands have non-empty /usr/bin entries`);
}
