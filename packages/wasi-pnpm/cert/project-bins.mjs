/**
 * A project's own commands and scripts (12.9.1-19), as bob under users
 * enforce, with local file: dependencies (no registry):
 * - homescoop#1247: with a file: dependency, pnpm's verify-deps-before-run
 *   re-runs pnpm (an install) before a script. The host refused that spawn
 *   ("Lifecycle scripts cannot run in slicc yet"), so `npm run s` and
 *   `pnpm run s` exited 1. Now the host starts pnpm as the pnpm command.
 * - homescoop#667: `pnpm exec <bin>`, `pnpm <bin>` and `npx <bin>` run the
 *   project's node_modules/.bin/<bin>, also from a subdirectory. The host
 *   runs the bin pnpm's PATH finds; the npx shim looks in node_modules/.bin
 *   from the working directory up before PATH.
 * - A name that isn't a command still fails with "command not found", and
 *   npx still says what to install.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  await ctx.addUser({ name: 'bob' });
  const sh = (s, cwd = '/home/bob') => run(['bash', '-c', s], { cwd, user: 'bob' });
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-1500)}`;

  const setup = await sh(String.raw`set -e
mkdir -p lib app/sub tool/bin
echo '{"name":"lib","version":"1.0.0","main":"i.js"}' > lib/package.json
echo 'module.exports=1' > lib/i.js
echo '{"name":"hello-bin","version":"1.0.0","bin":{"hello-bin":"bin/cli.sh"}}' > tool/package.json
printf '#!/bin/sh\necho "hello-out $*"\n' > tool/bin/cli.sh
chmod +x tool/bin/cli.sh
cd app
echo '{"name":"app","version":"1.0.0","private":true,"scripts":{"s":"echo ran-s","b":"hello-bin from-script"}}' > package.json
pnpm add file:../lib file:../tool`);
  assert.equal(setup.status, 0, `pnpm add file:../lib file:../tool: ${out(setup)}`);

  for (const [cmd, want] of [
    ['npm run s', /^ran-s$/m],
    ['pnpm run s', /^ran-s$/m],
    ['npm run b', /^hello-out from-script$/m],
  ]) {
    const r = await sh(cmd, '/home/bob/app');
    assert.equal(r.status, 0, `#1247 ${cmd} in a project with a file: dependency: ${out(r)}`);
    assert.match(r.stdout, want, `#1247 ${cmd} prints the script's output: ${out(r)}`);
    assert.doesNotMatch(r.stderr, /Lifecycle scripts cannot run/, `#1247 ${cmd}: no refusal`);
  }

  for (const [cmd, cwd] of [
    ['pnpm exec hello-bin x y', '/home/bob/app'],
    ['pnpm hello-bin x y', '/home/bob/app'],
    ['npx hello-bin x y', '/home/bob/app'],
    ['npx hello-bin x y', '/home/bob/app/sub'],
    ['pnpm exec hello-bin x y', '/home/bob/app/sub'],
  ]) {
    const r = await sh(cmd, cwd);
    assert.equal(r.status, 0, `#667 ${cmd} (in ${cwd}): ${out(r)}`);
    assert.match(r.stdout, /^hello-out x y$/m, `#667 ${cmd} (in ${cwd}) runs node_modules/.bin/hello-bin: ${out(r)}`);
  }

  const missing = await sh('pnpm exec no-such-bin', '/home/bob/app');
  assert.notEqual(missing.status, 0, `pnpm exec of a missing command fails: ${out(missing)}`);
  assert.match(missing.stdout + missing.stderr, /no-such-bin/, `the error names the command: ${out(missing)}`);
  const npxMissing = await sh('npx no-such-bin', '/home/bob/app');
  assert.equal(npxMissing.status, 127, `npx of a missing command: ${out(npxMissing)}`);
  assert.match(npxMissing.stderr, /'no-such-bin' is not installed/);
  console.log('project-bins: scripts run with a file: dependency; pnpm exec, pnpm <bin> and npx run node_modules/.bin, also from a subdirectory');
}
