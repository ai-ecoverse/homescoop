/**
 * tree under users enforce (#687, #824). 2.3.2-2 links the slicc credentials
 * (slicc_cred_js), so it reads directories as the caller; 2.3.2-3 also links
 * the getpwuid wrap, so -u names owners (2.3.2-2 printed the uid).
 *
 * Fixture (root-owned unless noted): pub 0755, priv 0700, xonly 0711,
 * ronly 0744 (cone may list it but not stat inside), mine 0700 cone:users.
 * The outputs for cone are upstream tree 2.3.2's (checked against a native
 * build on the same modes): an unopenable dir is "[error opening dir]" and
 * makes the run rc 2; a readable but unsearchable dir lists nothing.
 */
const BAR = '│\u00a0\u00a0 ';
const TEE = '├── ';
const END = '└── ';
const GAP = '    ';

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const setup = await run(['bash', '-c', [
    'rm -rf /tmp/tu && mkdir -p /tmp/tu/pub /tmp/tu/priv /tmp/tu/xonly /tmp/tu/ronly /tmp/tu/mine && cd /tmp/tu',
    'echo a > pub/a && echo b > priv/b && echo c > xonly/c && echo d > ronly/d && echo m > mine/m',
    'chmod 700 priv && chmod 711 xonly && chmod 744 ronly',
    'chown -R 1000:100 mine && chmod 700 mine && chmod 755 /tmp/tu',
  ].join(' && ')], { cwd: '/tmp' });
  assert.equal(setup.status, 0, `setup: ${setup.stderr}`);
  const tree = (args, user) => run(['tree', ...args], { cwd: '/tmp', ...(user && { user }) });

  const root = await tree(['/tmp/tu']);
  assert.equal(root.status, 0, `root: tree: rc=${root.status} stderr=${root.stderr}`);
  assert.equal(root.stdout, [
    '/tmp/tu',
    `${TEE}mine`, `${BAR}${END}m`,
    `${TEE}priv`, `${BAR}${END}b`,
    `${TEE}pub`, `${BAR}${END}a`,
    `${TEE}ronly`, `${BAR}${END}d`,
    `${END}xonly`, `${GAP}${END}c`,
    '', '6 directories, 5 files', '',
  ].join('\n'), 'root: tree reads every directory');

  const cone = await tree(['/tmp/tu'], 'cone');
  assert.equal(cone.status, 2, `cone: tree: rc=${cone.status} stderr=${cone.stderr}`);
  assert.equal(cone.stdout, [
    '/tmp/tu',
    `${TEE}mine`, `${BAR}${END}m`,
    `${TEE}priv  [error opening dir]`,
    `${TEE}pub`, `${BAR}${END}a`,
    `${TEE}ronly`,
    `${END}xonly  [error opening dir]`,
    '', '6 directories, 2 files', '',
  ].join('\n'), "cone: tree can't open root's 0700 / 0711 dirs, sees nothing in the 0744 one");

  const json = await tree(['-J', '/tmp/tu'], 'cone');
  assert.equal(json.status, 2, `cone: tree -J: rc=${json.status}`);
  const [top, report] = JSON.parse(json.stdout);
  const byName = Object.fromEntries(top.contents.map((d) => [d.name, d.contents]));
  assert.deepEqual(byName.priv, [{ error: 'error opening dir' }], 'cone: tree -J priv');
  assert.deepEqual(byName.xonly, [{ error: 'error opening dir' }], 'cone: tree -J xonly');
  assert.deepEqual(byName.ronly, [], 'cone: tree -J ronly');
  assert.deepEqual(byName.mine.map((f) => f.name), ['m'], 'cone: tree -J mine');
  assert.deepEqual(report, { type: 'report', directories: 6, files: 2 }, 'cone: tree -J report');

  const priv = await tree(['/tmp/tu/priv'], 'cone');
  assert.equal(priv.stdout.split('\n')[0], '/tmp/tu/priv  [error opening dir]', `cone: tree priv: ${priv.stdout}`);

  for (const user of [undefined, 'cone']) {
    const ug = await tree(['-pug', '-L', '1', '/tmp/tu'], user);
    const lines = ug.stdout.split('\n');
    assert.equal(lines[0], '[drwxr-xr-x root     root    ]  /tmp/tu', `${user ?? 'root'}: tree -pug names the owner (#824)`);
    assert.equal(lines[1], `${TEE}[drwx------ cone     users   ]  mine`, `${user ?? 'root'}: tree -pug mine (#824)`);
  }
  console.log("users: cone's tree gets '[error opening dir]' (rc 2) on root's 0700/0711 dirs and reads its own 0700; -u names owners");
}
