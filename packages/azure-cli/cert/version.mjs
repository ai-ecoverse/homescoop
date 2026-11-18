import { fresh, json, ok, sh, PKG, SITE } from './lib/az.mjs';

// az version is the release in package.json, with azure-cli-core and
// azure-cli-telemetry at the versions of their .dist-info and no extensions;
// az --version names wasix-python's CPython 3.15 and this package's tree.
// Nothing on stderr: no SyntaxWarning from compiling the SDKs (the launcher),
// no traceback. The command index ships with azure-cli-core
// (commandIndex.latest.json), so a first az group list loads only the
// resource module, not every command module.
export default async function (ctx) {
  const { assert } = ctx;
  const pkg = JSON.parse((await ok(ctx, `cat '${PKG}/package.json'`)).stdout);
  const release = pkg.homescoop.upstream;
  const meta = async (dist) => {
    const r = await ok(ctx, `cat ${SITE}/${dist}-*.dist-info/METADATA`);
    return r.stdout.match(/^Version: (\S+)$/m)[1];
  };
  const cfg = fresh('version');
  const v = await sh(ctx, `${cfg} az version`);
  assert.equal(v.status, 0, v.stderr);
  assert.deepEqual(JSON.parse(v.stdout), {
    'azure-cli': release,
    'azure-cli-core': await meta('azure_cli_core'),
    'azure-cli-telemetry': await meta('azure_cli_telemetry'),
    extensions: {},
  }, v.stdout);
  assert.equal(v.stderr, '', `az version stderr:\n${v.stderr}`);

  const long = await sh(ctx, `${cfg} az --version`);
  assert.equal(long.status, 0, long.stderr);
  assert.match(long.stdout, new RegExp(`^azure-cli +${release.replace(/\./g, '\\.')}`, 'm'), long.stdout);
  assert.match(long.stdout, /^Python \([^)]*\) 3\.15\./m, long.stdout);
  assert.match(long.stdout, /^Config directory '\/root\/\.azure-cert-version'$/m, long.stdout);

  // A first az group list (it stops at "please run az login") with --debug:
  // the packaged index answers, so only the resource module loads.
  const dbg = await sh(ctx, `${fresh('index')} az group list --debug`);
  assert.equal(dbg.status, 1, dbg.stderr);
  assert.match(dbg.stderr, /Please run 'az login' to setup account\./, dbg.stderr.slice(-2000));
  assert.match(dbg.stderr, /Using packaged command index for profile 'latest'\./, dbg.stderr.slice(0, 6000));
  assert.match(dbg.stderr, /Modules found from index for 'group': \['azure\.cli\.command_modules\.resource'\]/, dbg.stderr.slice(0, 6000));
  assert.doesNotMatch(dbg.stderr, /SyntaxWarning|[Rr]ebuild|Loading all modules/, dbg.stderr);
  // Help cut short by a closed pipe: no traceback, status 141 (as SIGPIPE).
  const cut = await sh(ctx, `${cfg} az vm list --help | head -3; echo "status=\${PIPESTATUS[0]}" >&2`);
  assert.match(cut.stdout, /^Command\n {4}az vm list : /m, cut.stdout);
  assert.match(cut.stderr, /status=141/, cut.stderr);
  assert.doesNotMatch(cut.stderr, /Traceback|BrokenPipe|unexpected error/, cut.stderr);
  console.log(`az version: azure-cli ${release}, core and telemetry from their dist-info, nothing on stderr; az --version: CPython 3.15 (wasi); a first az group list took the packaged command index (the resource module only); az vm list --help | head ends with 141, no traceback`);
}
