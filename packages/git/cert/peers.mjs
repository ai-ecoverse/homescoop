import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PEERS = ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-sed'];

export default async function (ctx) {
  const { run, assert, installed } = ctx;
  const pkg = installed[0];
  for (const field of ['dependencies', 'optionalDependencies']) {
    const own = Object.keys(pkg[field] ?? {}).filter((n) => n.startsWith('@ai-ecoverse/'));
    assert.deepEqual(own, [], `${field} names homescoop command packages, so npm nests its own copy under wasm-git whenever the user's top-level version differs (bios#939): ${JSON.stringify(pkg[field])}`);
  }
  assert.deepEqual(pkg.peerDependencies ?? null, Object.fromEntries(PEERS.map((p) => [p, '*'])), `sh (wasm-bash) and sed (wasm-sed) are peers with the range "*": npm accepts any installed version and installs latest when one is missing, where a floor such as >=4.10.0-6 would reject a later upstream's 4.11.0-1 (bios#939): ${JSON.stringify(pkg.peerDependencies ?? null)}`);
  for (const p of PEERS) {
    assert.notEqual(pkg.peerDependenciesMeta?.[p]?.optional, true, `${p} is a required peer: local clones need sh and git submodule needs sed`);
  }
  const meta = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'meta.json'), 'utf8'));
  for (const p of PEERS) assert.ok(meta.needs.includes(p), `cert/meta.json needs ${p}, so the specs run with the peers a user installs`);
  const tools = await run(['sh', '-c', 'command -v sh >/dev/null && command -v sed >/dev/null && echo ok'], { cwd: '/tmp' });
  assert.equal(tools.status, 0, `sh and sed resolve with the peers installed: ${tools.stderr}`);
  assert.equal(tools.stdout, 'ok\n', JSON.stringify(tools.stdout));
  const clone = await run(['bash', '-c', 'cd /tmp && git init -q -b main p && cd p && git config user.email r@x && echo p > f && git add f && git commit -qm p && cd /tmp && git clone -q /tmp/p q && cat q/f'], { cwd: '/tmp' });
  assert.equal(clone.status, 0, `git clone of a local repository starts git-upload-pack through sh: ${clone.stdout}${clone.stderr}`);
  assert.equal(clone.stdout, 'p\n', JSON.stringify(clone.stdout));
  console.log(`peers: ${PEERS.join(', ')} are peerDependencies "*", required, none in dependencies; sh, sed and a local clone work (bios#939)`);
}
