/**
 * wasi-bat under users enforce: bat reads what its user may read, keeps its
 * config and cache in that user's $HOME (patches/etcetera-wasi-home.patch),
 * and can't write into another user's cache. WASI's EACCES is errno 2, so
 * Rust prints "Permission denied (os error 2)".
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const out = (r) => `rc=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 600))} stderr=${JSON.stringify(r.stderr.slice(0, 600))}`;
  const setup = await run(['bash', '-c', [
    'printf "key = \\"bob-secret-7731\\"\\n" > /home/bob/secret.toml',
    'printf "name = \\"open\\"\\n" > /home/bob/open.toml',
    `chown ${bob.uid}:${bob.gid} /home/bob/secret.toml /home/bob/open.toml`,
    'chmod 755 /home/bob',
    'chmod 600 /home/bob/secret.toml',
    'chmod 644 /home/bob/open.toml',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, out(setup));
  const as = (user, script) => run(['bash', '-c', script], { cwd: `/home/${user}`, user });

  // Reading follows the file's mode.
  let r = await run(['bat', '/home/bob/secret.toml'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 1, `alice reads bob's 0600 file: ${out(r)}`);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /'\/home\/bob\/secret\.toml': Permission denied \(os error 2\)/, out(r));
  r = await run(['bat', '--color=never', '/home/bob/open.toml', '/home/bob/secret.toml'], { cwd: '/home/alice', user: 'alice' });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stdout, 'name = "open"\n', `the 0644 file still prints: ${out(r)}`);
  assert.doesNotMatch(r.stdout + r.stderr, /bob-secret-7731/);
  r = await run(['bat', '/home/bob/secret.toml'], { cwd: '/home/bob', user: 'bob' });
  assert.equal(r.stdout, 'key = "bob-secret-7731"\n', `bob reads his own: ${out(r)}`);
  r = await run(['bat', '/home/bob/secret.toml'], { cwd: '/root' });
  assert.equal(r.stdout, 'key = "bob-secret-7731"\n', `root reads it: ${out(r)}`);

  // Each user's config and cache are under their own $HOME.
  r = await as('alice', 'bat --config-dir; bat --cache-dir');
  assert.equal(r.stdout, '/home/alice/.config/bat\n/home/alice/.cache/bat\n', out(r));
  r = await as('bob', 'bat --config-dir; bat --cache-dir');
  assert.equal(r.stdout, '/home/bob/.config/bat\n/home/bob/.cache/bat\n', out(r));
  r = await as('alice', 'mkdir -p ~/.config/bat && printf -- "--decorations=always\\n--style=numbers\\n--color=never\\n" > ~/.config/bat/config && bat /home/bob/open.toml');
  assert.equal(r.stdout, '   1 name = "open"\n', `alice's config: ${out(r)}`);
  // homescoop#1895: without $HOME, alice's passwd entry, so her config.
  r = await as('alice', 'env -u HOME bat --config-dir; HOME= bat /home/bob/open.toml');
  assert.equal(r.stdout, '/home/alice/.config/bat\n   1 name = "open"\n', `alice without HOME: ${out(r)}`);
  r = await as('bob', 'bat /home/bob/open.toml');
  assert.equal(r.stdout, 'name = "open"\n', `bob doesn't get alice's config: ${out(r)}`);

  // bat cache --build writes the user's own cache; another user's is refused.
  r = await as('alice', 'bat cache --build && stat -c "%U %n" ~/.cache/bat/syntaxes.bin ~/.cache/bat/themes.bin ~/.cache/bat/metadata.yaml');
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /alice \/home\/alice\/\.cache\/bat\/syntaxes\.bin\nalice \/home\/alice\/\.cache\/bat\/themes\.bin\nalice \/home\/alice\/\.cache\/bat\/metadata\.yaml\n$/, out(r));
  r = await as('bob', 'BAT_CACHE_PATH=/home/alice/.cache/bat bat cache --build');
  assert.equal(r.status, 1, `bob builds into alice's cache: ${out(r)}`);
  assert.match(r.stderr, /Could not save theme set to \/home\/alice\/\.cache\/bat\/themes\.bin/, out(r));
  r = await as('bob', 'BAT_CACHE_PATH=/home/alice/.cache/bat bat cache --clear');
  assert.match(r.stdout, /could not remove the cache file "\/home\/alice\/\.cache\/bat\/syntaxes\.bin": Permission denied \(os error 2\)/, out(r));
  r = await as('alice', 'stat -c "%U %s" ~/.cache/bat/syntaxes.bin');
  assert.match(r.stdout, /^alice \d{6,}\n$/, `alice's cache is intact: ${out(r)}`);

  // The IO circle check holds for a user, and bob's file stays bob's.
  r = await as('alice', 'echo a > mine.txt; bat mine.txt >> mine.txt; echo rc=$?; cat mine.txt');
  assert.equal(r.stdout, 'rc=1\na\n', out(r));
  r = await as('alice', 'bat mine.txt >> /home/bob/open.toml; echo rc=$?');
  assert.equal(r.stdout, 'rc=1\n', out(r));
  r = await run(['cat', '/home/bob/open.toml'], { cwd: '/home' });
  assert.equal(r.stdout, 'name = "open"\n');
  console.log("users: alice can't read bob's 0600 file (os error 2) and never prints it; each user's config and cache are their own; bob can't build into or clear alice's cache; root reads everything");
}
