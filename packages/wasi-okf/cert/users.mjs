/**
 * wasi-okf under users enforce: alice validates and indexes her own bundle,
 * and the index files are hers; bob may read her 0755 bundle but his index
 * into it is refused, and her 0700 bundle is closed to him.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const concept = readFileSync(fileURLToPath(new URL('../test/fixtures/valid/datasets/ga4.md', import.meta.url)), 'utf8');

export default async function (ctx) {
  const { run, write, addUser, assert } = ctx;
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  await write('/home/alice/open/datasets/ga4.md', concept);
  await write('/home/alice/private/datasets/ga4.md', concept);
  const setup = await run(['bash', '-c', [
    `chown -R ${alice.uid}:${alice.gid} /home/alice`,
    'chmod 755 /home/alice /home/alice/open /home/alice/open/datasets',
    'chmod 644 /home/alice/open/datasets/ga4.md',
    'chmod 700 /home/alice/private',
    `mkdir -p /home/bob && chown ${bob.uid}:${bob.gid} /home/bob`,
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, `setup: ${out(setup)}`);

  let r = await run(['okf', 'index', '/home/alice/open'], { user: 'alice', cwd: '/home/alice' });
  assert.equal(r.status, 0, out(r));
  r = await run(['bash', '-c', 'ls -ln /home/alice/open/index.md'], { user: 'alice', cwd: '/home/alice' });
  assert.match(r.stdout, new RegExp(`^-\\S+ 1 ${alice.uid} ${alice.gid} `), `alice's index is hers: ${out(r)}`);

  r = await run(['okf', 'validate', '/home/alice/open'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 0, `bob may read her 0755 bundle: ${out(r)}`);
  r = await run(['okf', 'index', '/home/alice/open'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 2, `bob's index into her bundle is refused: ${out(r)}`);
  assert.match(r.stderr, /permission denied/i, out(r));
  r = await run(['okf', 'validate', '/home/alice/private'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 2, `her 0700 bundle is closed to bob: ${out(r)}`);
  assert.match(r.stderr, /permission denied/i, out(r));
  console.log('users: alice indexes her bundle (files hers); bob reads her 0755 bundle, his index into it and his read of her 0700 bundle are refused');
}
