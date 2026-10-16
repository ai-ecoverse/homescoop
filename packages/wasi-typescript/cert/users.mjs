export default async function (ctx) {
  const { run, write, read, assert, addUser } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const cfg = JSON.stringify({
    compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true,
      rootDir: 'src', outDir: 'dist', declaration: true, types: [],
    },
    include: ['src'],
  });
  await write('home/bob/proj/tsconfig.json', cfg);
  await write('home/bob/proj/src/index.ts', "import { key } from './secret';\nexport const shown: string = key;\n");
  await write('home/bob/proj/src/secret.ts', "export const key: string = 'bob-secret-7731';\n");
  await write('home/alice/proj/tsconfig.json', cfg);
  await write('home/alice/proj/src/main.ts', 'const n: number = 2;\nexport const m: number = n * 2;\n');
  const setup = await run(['bash', '-c', [
    `chown -R ${bob.uid}:${bob.gid} /home/bob/proj`,
    `chown -R ${alice.uid}:${alice.gid} /home/alice/proj`,
    'chmod 755 /home/bob /home/bob/proj /home/bob/proj/src',
    'chmod 644 /home/bob/proj/tsconfig.json /home/bob/proj/src/index.ts',
    'chmod 600 /home/bob/proj/src/secret.ts',
    'chmod 700 /home/alice',
  ].join(' && ')], { cwd: '/home' });
  assert.equal(setup.status, 0, `setup: ${setup.stdout}${setup.stderr}`);
  const tsc = (args, user, cwd) => run(['tsc', ...args, '--pretty', 'false'], { cwd, ...(user && { user }) });
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  let r = await tsc(['-p', '.'], 'bob', '/home/bob/proj');
  assert.equal(r.status, 0, `bob builds his own project: ${out(r)}`);
  assert.match(await read('home/bob/proj/dist/index.js'), /from '\.\/secret'/, 'bob: index.js emitted');
  assert.match(await read('home/bob/proj/dist/secret.js'), /bob-secret-7731/, 'bob: secret.js emitted');

  r = await tsc(['--noEmit', '-p', '/home/bob/proj'], 'alice', '/home/alice');
  assert.equal(r.status, 1, `alice checking bob's project with a 0600 file must fail: ${out(r)}`);
  assert.equal(r.stdout, "../bob/proj/src/index.ts(1,21): error TS2307: Cannot find module './secret' or its corresponding type declarations.\n", out(r));
  assert.doesNotMatch(r.stdout + r.stderr, /bob-secret-7731/, "alice: bob's secret never printed");

  r = await tsc(['-p', '/home/bob/proj', '--outDir', '/home/bob/proj/out'], 'alice', '/home/alice');
  assert.equal(r.status, 2, `alice emitting into bob's 0755 directory: ${out(r)}`);
  assert.match(r.stdout, /^error TS5033: Could not write file '\/home\/bob\/proj\/out\/index\.js': mkdir \/home\/bob\/proj\/out: Permission denied\.$/m, out(r));
  r = await run(['ls', '/home/bob/proj'], { cwd: '/home' });
  assert.equal(r.stdout, 'dist\nsrc\ntsconfig.json\n', `alice left nothing in bob's project: ${out(r)}`);

  r = await tsc(['-p', '.'], 'alice', '/home/alice/proj');
  assert.equal(r.status, 0, `alice builds her own project: ${out(r)}`);
  r = await run(['stat', '-c', '%u:%g %n', '/home/alice/proj/dist/main.js', '/home/bob/proj/dist/index.js'], { cwd: '/home' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, `${alice.uid}:${alice.gid} /home/alice/proj/dist/main.js\n${bob.uid}:${bob.gid} /home/bob/proj/dist/index.js\n`, 'each output belongs to whoever ran tsc');

  r = await tsc(['--noEmit', '-p', '/home/alice/proj'], 'bob', '/home/bob');
  assert.equal(r.status, 1, `bob is refused alice's 0700 home: ${out(r)}`);
  assert.equal(r.stdout, "error TS5058: The specified path does not exist: '/home/alice/proj'.\n", out(r));

  r = await tsc(['--noEmit', '-p', '/home/bob/proj'], null, '/root');
  assert.equal(r.status, 0, `root checks bob's project, 0600 file included: ${out(r)}`);
  console.log("users: alice can't read bob's 0600 file (TS2307) or write into his project (TS5033, Permission denied); bob is refused alice's 0700 home (TS5058); outputs belong to their user; root checks everything");
}
