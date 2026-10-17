export default async function (ctx) {
  const { run, write, read, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });

  await write('home/bob/app/src/index.ts', "import { key } from './secret';\nexport const shown: string = key;\n");
  await write('home/bob/app/src/secret.ts', "export const key: string = 'bob-secret-7731';\n");
  await write('home/bob/app/src/public.ts', "export const hello: string = 'bob-public';\n");
  await write('home/alice/src/main.ts', "import { hello } from '/home/bob/app/src/public';\nconst n: number = 2;\nconsole.log(hello, n);\n");
  const setup = await run(['bash', '-c', [
    `chown -R ${bob.uid}:${bob.gid} /home/bob/app`,
    `chown -R ${alice.uid}:${alice.gid} /home/alice/src`,
    'chmod 755 /home/bob /home/bob/app /home/bob/app/src',
    'chmod 644 /home/bob/app/src/index.ts /home/bob/app/src/public.ts',
    'chmod 600 /home/bob/app/src/secret.ts',
    'chmod 700 /home/alice',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const as = (argv, user) => run(argv, { cwd: `/home/${user}`, user });
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  let r = await as(['esbuild', '--bundle', 'app/src/index.ts', '--outfile=app/dist/out.js', '--format=esm'], 'bob');
  assert.equal(r.status, 0, `bob bundles his own project: ${out(r)}`);
  assert.match(await read('home/bob/app/dist/out.js'), /bob-secret-7731/, 'bob: secret.ts bundled');

  r = await as(['esbuild', '--bundle', '/home/bob/app/src/index.ts', '--outfile=/home/alice/stolen.js', '--format=esm'], 'alice');
  assert.equal(r.status, 1, `alice bundling bob's 0600 secret.ts must fail: ${out(r)}`);
  assert.match(r.stderr, /Cannot read file "\.\.\/bob\/app\/src\/secret\.ts": Permission denied/, `alice: refused secret.ts: ${out(r)}`);
  assert.doesNotMatch(r.stdout + r.stderr, /bob-secret-7731/, "alice: bob's secret never printed");
  assert.equal(await read('home/alice/stolen.js'), null, 'alice: no output written for a failed bundle');

  r = await as(['esbuild', '--bundle', 'src/main.ts', '--outfile=/home/bob/app/dist/alice.js', '--format=esm'], 'alice');
  assert.equal(r.status, 1, `alice writing into bob's 0755 directory must fail: ${out(r)}`);
  assert.match(r.stderr, /Failed to write to output file: open \/home\/bob\/app\/dist\/alice\.js: Permission denied/, `alice: write refused: ${out(r)}`);
  assert.equal(await read('home/bob/app/dist/alice.js'), null, "alice: nothing written in bob's directory");

  r = await as(['esbuild', '--bundle', 'src/main.ts', '--outfile=dist/main.js', '--format=esm'], 'alice');
  assert.equal(r.status, 0, `alice bundles her project with bob's 0644 public.ts: ${out(r)}`);
  const mine = await read('home/alice/dist/main.js');
  assert.match(mine, /bob-public/, "alice: bob's public.ts bundled");
  assert.doesNotMatch(mine, /: number/, 'alice: types stripped');
  r = await run(['stat', '-c', '%u:%g %n', '/home/alice/dist/main.js'], { cwd: '/home' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, `${alice.uid}:${alice.gid} /home/alice/dist/main.js\n`, "alice: her output is hers");

  r = await as(['esbuild', '--bundle', '/home/alice/src/main.ts', '--format=esm'], 'bob');
  assert.equal(r.status, 1, `bob reading alice's 0700 home must fail: ${out(r)}`);
  assert.match(r.stderr, /Cannot read directory "\.\.\/alice\/src": Permission denied/, `bob: refused alice's home: ${out(r)}`);
  assert.match(r.stderr, /Could not resolve "\/home\/alice\/src\/main\.ts"/, `bob: entry unresolved: ${out(r)}`);

  r = await run(['esbuild', '--bundle', '/home/bob/app/src/index.ts', '--format=esm'], { cwd: '/root' });
  assert.equal(r.status, 0, `root bundles bob's project: ${out(r)}`);
  assert.match(r.stdout, /bob-secret-7731/, 'root: reads the 0600 secret.ts');
  console.log("users: alice is refused bob's 0600 import and his directory (rc 1, Permission denied); bob is refused alice's 0700 home; her output is hers; root reads everything");
}
