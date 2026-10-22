export default async function gitTabs(ctx) {
  const { run, read, assert, npmName } = ctx;
  const readme = await read(`/node_modules/${npmName}/README.md`);
  assert.ok(readme, 'the package README is installed');
  const flat = readme.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /until \[?slicc-kernel#949\]?(\([^)]*\))? is fixed/, 'README: slicc-kernel#949 is fixed since 1.120.1, so no "until #949 is fixed" line (homescoop#952)');
  assert.match(flat, /slicc-kernel 1\.100\.0 between processes, homescoop#513/, 'README: the cross-process lock floor');
  assert.match(flat, /1\.119\.0 across tabs, slicc-kernel#944/, 'README: the cross-tab lock floor');
  assert.match(flat, /coherent in the other tab since slicc-kernel 1\.120\.1 \(slicc-kernel#949\)/, 'README: cross-tab coherence (homescoop#952)');
  assert.match(flat, /since 1\.122\.3 \(slicc-kernel#950\)/, 'README: cross-tab opens');
  assert.match(flat, /On older kernels, use one process per repository at a time/, 'README: one process per repository on older kernels');
  const r = await run(
    [
      'bash',
      '-c',
      [
        'cd /root && git init -q -b main lk && cd lk && git config user.email l@x && echo a > f && git add f && git commit -qm one',
        'echo b > f && : > .git/index.lock',
        'git add f; echo rc=$?',
        'rm .git/index.lock && git add f && git commit -qm two && git log --format=%s',
      ].join(' && '),
    ],
    { cwd: '/tmp' },
  );
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, 'rc=128\ntwo\none\n', JSON.stringify(r.stdout));
  assert.match(r.stderr, /Unable to create '\/root\/lk\/\.git\/index\.lock': File exists/, r.stderr);
  console.log('git tabs: the README gives the cross-process and cross-tab kernel floors (no "until #949 is fixed"); a held index.lock makes git add fail, rc 128, File exists, and the repository commits once it is gone');
}
