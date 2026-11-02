import { readFileSync } from 'node:fs';

const version = readFileSync(new URL('../recipe.yaml', import.meta.url), 'utf8').match(/^version: "([^"]+)"$/m)[1];
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const cmd of ['zprobe', 'zprobe-pic']) {
    const cwd = `/home/${cmd}`;
    assert.equal((await run(['mkdir', '-p', cwd])).status, 0);
    const r = await run([cmd], { cwd });
    assert.equal(r.status, 0, `${cmd}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.ok(r.stdout.split('\n').includes(`zlib ${version}`), `${cmd}: zlibVersion() is recipe ${version}`);
    assert.match(r.stdout, /^sizeof\(z_off_t\) 8$/m, cmd);
    assert.match(r.stdout, /^zprobe ok$/m, cmd);
    const magic = await run(['bash', '-c', 'od -An -tx1 -N2 probe.gz | tr -d " \\n"'], { cwd });
    assert.equal(magic.stdout, '1f8b', `${cmd}: probe.gz magic`);
  }
}
