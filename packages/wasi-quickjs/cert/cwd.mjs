export default async function (ctx) {
  const { run, assert } = ctx;
  const P = '/home/qjscwd';
  const D = `${P}/sub`;
  const out = (label, r) => `${label}: rc=${r.status}\n--- stdout\n${String(r.stdout).slice(0, 600)}\n--- stderr\n${String(r.stderr).slice(0, 600)}`;
  const setup = await run(['bash', '-c', [
    `mkdir -p ${D}/tmp ${D}/inner ${D}/home /tmp/qjscwd-tmp`,
    `echo sub-tmp > ${D}/tmp/where.txt`,
    'echo root-tmp > /tmp/where.txt',
    `echo only-in-sub > ${D}/only-in-sub.txt`,
    `echo inner > ${D}/inner/x.txt`,
    'echo only-in-tmp > /tmp/qjscwd-only-in-tmp.txt',
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, out('setup', setup));

  const probe = [
    'import * as std from "qjs:std";',
    'import * as os from "qjs:os";',
    'const load = (p) => { const s = std.loadFile(p); return s === null ? null : s.trim(); };',
    'const names = (p) => { const [l, e] = os.readdir(p); return e ? "errno " + e : l.filter((n) => n[0] !== ".").sort().join(","); };',
    'const f = std.open("created.txt", "w"); f.puts("made\\n"); f.close();',
    'console.log(JSON.stringify({',
    '  cwd: os.getcwd()[0],',
    '  tmp: load("tmp/where.txt"),',
    '  absTmp: load("/tmp/where.txt"),',
    '  dot: load("./only-in-sub.txt"),',
    '  up: load("../sub/inner/x.txt"),',
    '  abs: load("' + '/home/qjscwd/sub/only-in-sub.txt' + '"),',
    '  here: names("."),',
    '  root: names("/").split(",").filter((n) => ["home", "tmp", "only-in-sub.txt", "inner"].includes(n)).join(","),',
    '  homeDir: names("/home").split(",").includes("qjscwd"),',
    '}));',
  ].join('\n');
  const want = {
    cwd: D,
    tmp: 'sub-tmp',
    absTmp: 'root-tmp',
    dot: 'only-in-sub',
    up: 'inner',
    abs: 'only-in-sub',
    here: 'created.txt,home,inner,only-in-sub.txt,tmp',
    root: 'home,tmp',
    homeDir: true,
  };
  const check = async (label, env) => {
    await run(['bash', '-c', `rm -f ${D}/created.txt /tmp/created.txt /created.txt`], { cwd: '/' });
    const r = await run(['qjs', '-e', probe], { cwd: D, env });
    assert.equal(r.status, 0, out(label, r));
    assert.deepEqual(JSON.parse(r.stdout), want, out(label, r));
    const made = await run(['bash', '-c', `cat ${D}/created.txt; ls /tmp/created.txt /created.txt 2>&1 | wc -l`], { cwd: '/' });
    assert.equal(made.stdout, 'made\n2\n', out(`${label}: created.txt in the cwd only`, made));
  };
  for (const [label, env] of [
    ['PWD is the cwd', {}],
    ['PWD=/tmp (stale)', { PWD: '/tmp' }],
    ['PWD=/nonexistent', { PWD: '/nonexistent' }],
    ['PWD=sub (relative)', { PWD: 'sub' }],
    ['PWD with ..', { PWD: `${P}/inner/../sub` }],
    ['PWD=/', { PWD: '/' }],
    ['PWD names another directory', { PWD: '/tmp/qjscwd-tmp' }],
  ]) await check(label, env);

  let r = await run(['bash', '-c', `cd ${D} && PWD=/tmp qjs -e 'import * as os from "qjs:os"; console.log(os.getcwd()[0])'`], { cwd: '/' });
  assert.equal(r.stdout, `${D}\n`, out('bash cd, then a stale PWD', r));
  r = await run(['qjs', '-e', 'import * as os from "qjs:os"; console.log(os.getcwd()[0], os.readdir("/")[0].includes("home"))'], { cwd: '/', env: { PWD: D } });
  assert.equal(r.stdout, '/ true\n', out('cwd / with PWD naming sub', r));
  r = await run(['qjs', '-e', 'import * as std from "qjs:std"; import * as os from "qjs:os"; os.chdir("inner"); console.log(os.getcwd()[0], std.loadFile("x.txt").trim()); os.chdir("/tmp"); console.log(os.getcwd()[0], std.loadFile("where.txt").trim())'], { cwd: D });
  assert.equal(r.stdout, `${D}/inner inner\n/tmp root-tmp\n`, out('os.chdir', r));
  console.log('cwd: relative paths resolve against the real working directory with any PWD, / is the root, os.getcwd() and os.chdir agree');
}
