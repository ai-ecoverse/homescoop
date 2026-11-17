import { readFileSync } from 'node:fs';

const version = readFileSync(new URL('../recipe.yaml', import.meta.url), 'utf8').match(/^version: "([^"]+)"$/m)[1];
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const cmd of ['sodiumprobe', 'sodiumprobe-pic']) {
    const r = await run([cmd], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${cmd}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.ok(r.stdout.split('\n').includes(`libsodium ${version}`), `${cmd}: sodium_version_string() is recipe ${version}: ${r.stdout}`);
    assert.match(r.stdout, /^randombytes sysrandom$/m, `${cmd}: the system RNG (arc4random_buf -> WASI random_get)`);
    assert.match(r.stdout, /^(fork unavailable \(.*\)|fork: parent and child draw different bytes)$/m, `${cmd}: fork check ran`);
    assert.match(r.stdout, /^sodiumprobe ok$/m, `${cmd}: ${r.stdout}`);
  }
}
