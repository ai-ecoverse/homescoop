import { fixture } from '../test/goldens.mjs';

export default async function (ctx) {
  const { run, write, read, addUser, assert } = ctx;
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const ci = fixture('ci.yml');
  await write('/home/alice/repo/.github/workflows/ci.yml', ci);
  await write('/home/alice/private/k8s.yaml', fixture('k8s.yaml'));
  const setup = await run(['bash', '-c', [
    `chown -R ${alice.uid}:${alice.gid} /home/alice`,
    'chmod 755 /home/alice /home/alice/repo /home/alice/repo/.github /home/alice/repo/.github/workflows',
    'chmod 644 /home/alice/repo/.github/workflows/ci.yml',
    'chmod 700 /home/alice/private && chmod 600 /home/alice/private/k8s.yaml',
    `mkdir -p /home/bob && chown ${bob.uid}:${bob.gid} /home/bob`,
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, `setup: ${out(setup)}`);
  const wf = '/home/alice/repo/.github/workflows/ci.yml';

  let r = await run(['yq', '-i', '.jobs.lint.runs-on = "ubuntu-24.04"', '.github/workflows/ci.yml'], { user: 'alice', cwd: '/home/alice/repo' });
  assert.equal(r.status, 0, out(r));
  r = await run(['bash', '-c', `yq '.jobs.lint.runs-on' ${wf} && ls -ln ${wf}`], { user: 'alice', cwd: '/home/alice' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, new RegExp(`^ubuntu-24\\.04\\n-rw-r--r-- 1 ${alice.uid} ${alice.gid} `), `alice edits her own workflow in place; it stays hers and 0644: ${out(r)}`);
  const edited = await read(wf);
  assert.ok(edited.includes('# pinned by tag'), 'comments kept');
  r = await run(['yq', '.kind', 'private/k8s.yaml'], { user: 'alice', cwd: '/home/alice' });
  assert.equal(r.stdout, 'ConfigMap\n---\nDeployment\n---\nService\n', out(r));

  r = await run(['yq', '.jobs.lint.runs-on', wf], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'ubuntu-24.04\n', 'bob may read her 0644 workflow');
  r = await run(['yq', '-i', '.jobs.lint.runs-on = "evil"', wf], { user: 'bob', cwd: '/home/bob' });
  assert.notEqual(r.status, 0, `bob's -i on alice's workflow is refused: ${out(r)}`);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^Error: .*Permission denied\n$/, out(r));
  assert.equal(await read(wf), edited, 'her workflow is unchanged');
  r = await run(['yq', '.kind', '/home/alice/private/k8s.yaml'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 1, out(r));
  assert.equal(r.stderr, 'Error: open /home/alice/private/k8s.yaml: Permission denied\n', out(r));
  r = await run(['yq', '-i', '.spec.replicas = 0', '/home/alice/private/k8s.yaml'], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /^Error: .*\/home\/alice\/private\/k8s\.yaml: Permission denied\n$/, out(r));
  assert.equal(await read('/home/alice/private/k8s.yaml'), fixture('k8s.yaml'), 'her private manifest is unchanged');

  r = await run(['bash', '-c', `yq -o json ${wf} > mine.json && ls -ln mine.json && yq '.name' mine.json`], { user: 'bob', cwd: '/home/bob' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, new RegExp(`^-rw-r--r-- 1 ${bob.uid} ${bob.gid} .* mine\\.json\\n"CI"\\n$`), `bob's own output is his: ${out(r)}`);
  r = await run(['yq', '.spec.replicas', '/home/alice/private/k8s.yaml'], { cwd: '/' });
  assert.equal(r.stdout, 'null\n---\n2\n---\nnull\n', `root reads her private manifest: ${out(r)}`);
  r = await run(['bash', '-c', `yq -i '.name = "CI (root)"' ${wf} && ls -ln ${wf}`], { cwd: '/' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /^-rw-r--r-- 1 0 0 /, `root's -i on her workflow leaves it root's, as on macOS (wasip1 has no chown; README): ${out(r)}`);
  assert.equal((await run(['yq', '.name', wf], { cwd: '/' })).stdout, 'CI (root)\n');
  console.log("users: alice edits her workflow in place (kept hers, 0644, comments kept); bob reads it but his -i is refused and changes nothing; her 0700 manifest is closed to bob; bob's output is his; root reads everything, and root's -i leaves the file root's (no chown on wasip1)");
}
