import { entraAndArm, fresh, json, ok, sh, PKG, SITE } from './lib/az.mjs';

// bin/az (src/launcher.py) runs az on its own tree: the site-packages
// directories (wasix-python's, py-* packages', /usr/local's) leave sys.path,
// and a module a .pth there imported before az started is dropped, so a
// package installed beside az can't shadow one of az's pinned modules.
// AZURE_CLI_SITEPACKAGES=1 keeps them, after lib/azure-cli. requests trusts
// the kernel proxy's CA (REQUESTS_CA_BUNDLE from SSL_CERT_FILE) also without
// the kernel's CURL_CA_BUNDLE, unless the caller names another bundle. The
// launcher refuses any other name.
export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(entraAndArm);
  const sp = (await ok(ctx, `python3 -c 'import site; print(site.getsitepackages()[0])'`)).stdout.trim();
  // A shadowing yaml (no dump) and a fake cryptography in wasix-python's
  // site-packages, and a .pth that imports the fake yaml at startup.
  await write(`${sp}/yaml/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: shadow yaml imported\\n")\nSHADOW = True\n');
  await write(`${sp}/cryptography/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: fake cryptography imported\\n")\nraise ImportError("azure-cli-cert: fake cryptography")\n');
  await write(`${sp}/zz-azure-cli-cert.pth`, 'import yaml\n');
  try {
    const plain = await ok(ctx, `python3 -c 'import yaml; print(yaml.SHADOW)'`);
    assert.equal(plain.stdout.trim(), 'True', 'the shadow yaml is what a plain python3 imports');
    assert.match(plain.stderr, /shadow yaml imported/, 'the .pth runs');

    const cfg = fresh('launcher');
    await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
    const y = await sh(ctx, `${cfg} az group list -o yaml`);
    assert.equal(y.status, 0, `az group list -o yaml: ${y.stderr}`);
    assert.match(y.stdout, /^- id: \/subscriptions\/[^/]+\/resourceGroups\/cert-rg$/m, y.stdout);
    assert.match(y.stdout, /^ {2}name: cert-rg$/m, y.stdout);
    const kv = await sh(ctx, `${cfg} az keyvault list`);
    assert.equal(kv.status, 1, kv.stderr);
    assert.doesNotMatch(kv.stderr, /fake cryptography imported/, `az imported site-packages' cryptography:\n${kv.stderr}`);
    assert.match(kv.stderr, /^ERROR: This command needs cryptography/m, kv.stderr);

    const keep = await sh(ctx, `AZURE_CLI_SITEPACKAGES=1 ${cfg} az keyvault list`);
    assert.match(keep.stderr, /fake cryptography imported/, `AZURE_CLI_SITEPACKAGES=1: site-packages should be on the path, after az's own:\n${keep.stderr}`);
    const keepYaml = await ok(ctx, `AZURE_CLI_SITEPACKAGES=1 ${cfg} az group list -o yaml`);
    assert.match(keepYaml.stdout, /^ {2}name: cert-rg$/m, 'az\'s own yaml still comes first');

    // requests reads REQUESTS_CA_BUNDLE or CURL_CA_BUNDLE, never
    // SSL_CERT_FILE. The kernel sets CURL_CA_BUNDLE too; without it, the
    // launcher's REQUESTS_CA_BUNDLE is what makes TLS through the proxy work.
    const noCurl = await sh(ctx, `env -u CURL_CA_BUNDLE ${fresh('launcher-nocurl')} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
    assert.equal(noCurl.status, 0, `without CURL_CA_BUNDLE: rc=${noCurl.status}\n${noCurl.stderr}`);
    // The caller's REQUESTS_CA_BUNDLE wins over SSL_CERT_FILE.
    await write('/root/other-ca.pem', '');
    const other = await sh(ctx, `REQUESTS_CA_BUNDLE=/root/other-ca.pem ${fresh('launcher-ca')} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de`);
    assert.equal(other.status, 1, other.stdout);
    assert.match(other.stderr, /SSL|certificate|CA bundle|TLS/i, other.stderr);
  } finally {
    await sh(ctx, `rm -rf '${sp}/yaml' '${sp}/cryptography' '${sp}/zz-azure-cli-cert.pth'`);
  }

  // The launcher runs only as az.
  await ok(ctx, `cp '${PKG}/bin/az' /tmp/azure`);
  const otherName = await sh(ctx, 'python3 /tmp/azure version');
  assert.equal(otherName.status, 1, otherName.stdout + otherName.stderr);
  assert.match(otherName.stderr, /runs only as az/, otherName.stderr);
  const v = await json(ctx, `${fresh('launcher')} az version`);
  assert.ok(v['azure-cli'], `az version after the probes: ${JSON.stringify(v)}`);
  console.log(`launcher: a shadow yaml and a fake cryptography in ${sp} (yaml imported by a .pth) don't reach az (az group list -o yaml from ${SITE}, az keyvault list names the missing cryptography); AZURE_CLI_SITEPACKAGES=1 puts site-packages back after az's own; TLS works without CURL_CA_BUNDLE (REQUESTS_CA_BUNDLE from SSL_CERT_FILE); a caller REQUESTS_CA_BUNDLE wins`);
}
