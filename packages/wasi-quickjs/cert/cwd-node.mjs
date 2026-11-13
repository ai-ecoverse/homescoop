export default async function (ctx) {
  const { run, write, assert } = ctx;
  const D = '/home/qjsnode/sub';
  const out = (label, r) => `${label}: rc=${r.status}\n--- stdout\n${String(r.stdout).slice(0, 600)}\n--- stderr\n${String(r.stderr).slice(0, 600)}`;
  const setup = await run(['bash', '-c', `mkdir -p ${D}/tmp && echo sub-tmp > ${D}/tmp/where.txt && echo root-tmp > /tmp/where.txt`], { cwd: '/' });
  assert.equal(setup.status, 0, out('setup', setup));
  const probe = 'import * as std from "qjs:std"; import * as os from "qjs:os"; console.log(os.getcwd()[0], std.loadFile("tmp/where.txt").trim())';
  await write('tmp/qjs-cwd.mjs', `
import { spawnSync } from 'node:child_process';
const D = ${JSON.stringify(D)};
const probe = ${JSON.stringify(probe)};
const noPwd = { ...process.env };
delete noPwd.PWD;
const pick = (r) => ({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ? String(r.error) : null });
console.log(JSON.stringify({
  pwd: process.env.PWD,
  stale: pick(spawnSync('qjs', ['-e', probe], { cwd: D, encoding: 'utf8' })),
  shell: pick(spawnSync('sh', ['-c', 'qjs -e "$0"', probe], { cwd: D, encoding: 'utf8' })),
  noPwd: pick(spawnSync('qjs', ['-e', probe], { cwd: D, encoding: 'utf8', env: noPwd })),
}));
`);
  const node = await run(['node', '/tmp/qjs-cwd.mjs'], { cwd: '/tmp' });
  assert.equal(node.status, 0, out('node', node));
  const got = JSON.parse(node.stdout);
  assert.equal(got.pwd, '/tmp', 'node runs with PWD=/tmp');
  for (const k of ['stale', 'shell', 'noPwd']) {
    assert.equal(got[k].error, null, `${k}: ${JSON.stringify(got[k])}`);
    assert.equal(got[k].stdout, `${D} sub-tmp\n`, `node spawnSync ${k}: ${JSON.stringify(got[k])}`);
  }
  console.log("cwd-node: node's spawnSync('qjs', …, { cwd }) with PWD=/tmp inherited, through sh -c and without PWD: qjs works in the cwd");
}
