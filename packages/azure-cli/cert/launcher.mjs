import { entraAndArm, fresh, json, ok, sh, PKG, SITE } from './lib/az.mjs';

const NM = '/node_modules/@ai-ecoverse';
const SHADOW = `${NM}/py-certshadow`;

// bin/az (src/launcher.py) runs az on its own tree and the py-* packages its
// package.json pins, nothing else: the site-packages directories
// (wasix-python's, other py-* packages', /usr/local's) leave sys.path, and a
// module a .pth there imported before az started is dropped, so a package
// installed beside az can't shadow one of az's pinned modules, nor stand in
// for one of its native ones. Its own py-* packages it finds as Node would
// from its directory, and takes only at the version it pins: a py-bcrypt of
// another version, or a py-cffi that isn't there (which py-cryptography
// needs), is one ERROR line that says so, no traceback.
// AZURE_CLI_SITEPACKAGES=1 adds the rest of site-packages after them. requests
// trusts the kernel proxy's CA (REQUESTS_CA_BUNDLE from SSL_CERT_FILE) also
// without the kernel's CURL_CA_BUNDLE, unless the caller names another
// bundle. The launcher refuses any other name.
export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(entraAndArm);
  const sp = (await ok(ctx, `python3 -c 'import site; print(site.getsitepackages()[0])'`)).stdout.trim();
  // In wasix-python's site-packages: a shadowing yaml (no dump), imported at
  // startup by a .pth, a fake cryptography and a fake psutil.
  await write(`${sp}/yaml/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: shadow yaml imported\\n")\nSHADOW = True\n');
  await write(`${sp}/cryptography/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: fake cryptography imported\\n")\nFAKE = True\n');
  await write(`${sp}/psutil/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: fake psutil imported\\n")\nraise ImportError("azure-cli-cert: fake psutil")\n');
  await write(`${sp}/zz-azure-cli-cert.pth`, 'import yaml\n');
  // Beside az, a py-* package that isn't one of its dependencies, which
  // wasix-python's discovery puts on a plain python3's path: a shadow knack
  // and a fake nacl.
  await write(`${SHADOW}/package.json`, JSON.stringify({ name: '@ai-ecoverse/py-certshadow', version: '1.0.0-1', slicc: { python: { sitePackages: 'lib/python3/site-packages' } } }));
  await write(`${SHADOW}/lib/python3/site-packages/knack/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: shadow knack imported\\n")\nSHADOW = True\n');
  await write(`${SHADOW}/lib/python3/site-packages/nacl/__init__.py`, 'import sys\nsys.stderr.write("azure-cli-cert: fake nacl imported\\n")\nFAKE = True\n');
  const bcryptJson = `${NM}/py-bcrypt/package.json`;
  const bcryptManifest = await ctx.read(bcryptJson);
  try {
    const plain = await ok(ctx, `python3 -c 'import yaml, cryptography, knack; print(yaml.SHADOW, cryptography.FAKE, knack.SHADOW)'`);
    assert.equal(plain.stdout.trim(), 'True True True', 'the shadows are what a plain python3 imports');
    assert.match(plain.stderr, /shadow yaml imported/, 'the .pth runs');

    const cfg = fresh('launcher');
    await ok(ctx, 'rm -rf /root/.azure-cert-launcher');
    await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
    const y = await sh(ctx, `${cfg} az group list -o yaml`);
    assert.equal(y.status, 0, `az group list -o yaml: ${y.stderr}`);
    assert.match(y.stdout, /^- id: \/subscriptions\/[^/]+\/resourceGroups\/cert-rg$/m, y.stdout);
    assert.match(y.stdout, /^ {2}name: cert-rg$/m, y.stdout);
    // The .pth ran before the launcher (its shadow yaml prints), which drops
    // the module again; nothing else of the shadows is imported.
    const shadows = /azure-cli-cert: (fake cryptography|fake nacl|shadow knack|fake psutil) imported/;
    assert.doesNotMatch(y.stderr, shadows, y.stderr);
    // az keyvault (cryptography) and az webapp (PyNaCl) take az's own py-*.
    for (const c of ['keyvault list', 'webapp list']) {
      const r = await sh(ctx, `${cfg} az ${c}`);
      assert.equal(r.status, 0, `az ${c}: rc=${r.status}\n${r.stderr}`);
      assert.equal(r.stdout.trim(), '[]', r.stdout);
      assert.doesNotMatch(r.stderr, shadows, `az ${c} imported a shadow:\n${r.stderr}`);
    }
    const rest = `az rest --url "https://management.azure.com/subscriptions?api-version=2022-12-01" --headers x-cert=1 --debug`;
    const noPsutil = await ok(ctx, `${cfg} ${rest}`);
    assert.doesNotMatch(noPsutil.stderr, /fake psutil imported/, noPsutil.stderr.slice(-4000));
    assert.match(noPsutil.stderr, /This command needs psutil \(native code\)/, noPsutil.stderr.slice(-4000));

    // A py-bcrypt of another version than package.json pins: az doesn't take
    // it, and az webapp (fabric, paramiko, bcrypt) says so.
    await write(bcryptJson, bcryptManifest.replace(/"version": "5\.0\.0-1"/, '"version": "5.0.0-99"'));
    const plainBcrypt = await ok(ctx, `python3 -c 'import bcrypt; print(bcrypt.__file__)'`);
    assert.match(plainBcrypt.stdout, /py-bcrypt/, 'discovery still takes it for a plain python3');
    const wrong = await sh(ctx, `${cfg} az webapp list`);
    assert.equal(wrong.status, 1, `${wrong.stdout}\n${wrong.stderr}`);
    assert.match(wrong.stderr, new RegExp(`^ERROR: This command needs bcrypt, from @ai-ecoverse/py-bcrypt, which az couldn't use: ${NM}/py-bcrypt is @ai-ecoverse/py-bcrypt 5\\.0\\.0-99, az needs @ai-ecoverse/py-bcrypt 5\\.0\\.0-1 \\(No module named 'bcrypt'\\)\\.$`, 'm'), wrong.stderr);
    assert.doesNotMatch(wrong.stderr, /Traceback|unexpected error/, wrong.stderr);
    await write(bcryptJson, bcryptManifest);

    // No py-cffi: py-cryptography needs it, so az takes neither.
    await ok(ctx, `mv ${NM}/py-cffi /root/py-cffi.away`);
    try {
      const kv = await sh(ctx, `${cfg} az keyvault list`);
      assert.equal(kv.status, 1, `${kv.stdout}\n${kv.stderr}`);
      assert.match(kv.stderr, /^ERROR: This command needs cryptography, from @ai-ecoverse\/py-cryptography, which az couldn't use: it needs @ai-ecoverse\/py-cffi, which az couldn't use: it isn't installed beside az \(az needs 2\.1\.1-2\) \(No module named 'cryptography'\)\.$/m, kv.stderr);
      assert.doesNotMatch(kv.stderr, /Traceback|unexpected error/, kv.stderr);
      assert.doesNotMatch(kv.stderr, shadows, kv.stderr);
    } finally {
      await ok(ctx, `mv /root/py-cffi.away ${NM}/py-cffi`);
    }

    // AZURE_CLI_SITEPACKAGES=1: the rest of site-packages after az's own.
    const keep = await ok(ctx, `AZURE_CLI_SITEPACKAGES=1 ${cfg} ${rest}`);
    assert.match(keep.stderr, /fake psutil imported/, `AZURE_CLI_SITEPACKAGES=1: site-packages should be on the path, after az's own:\n${keep.stderr.slice(-4000)}`);
    const keepKv = await ok(ctx, `AZURE_CLI_SITEPACKAGES=1 ${cfg} az keyvault list`);
    assert.doesNotMatch(keepKv.stderr, /fake cryptography imported/, 'az\'s own py-cryptography still comes first');
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
    await write(bcryptJson, bcryptManifest);
    await sh(ctx, `rm -rf '${sp}/yaml' '${sp}/cryptography' '${sp}/psutil' '${sp}/zz-azure-cli-cert.pth' '${SHADOW}'`);
  }

  // The launcher runs only as az.
  await ok(ctx, `cp '${PKG}/bin/az' /tmp/azure`);
  const otherName = await sh(ctx, 'python3 /tmp/azure version');
  assert.equal(otherName.status, 1, otherName.stdout + otherName.stderr);
  assert.match(otherName.stderr, /runs only as az/, otherName.stderr);
  const v = await json(ctx, `${fresh('launcher')} az version`);
  assert.ok(v['azure-cli'], `az version after the probes: ${JSON.stringify(v)}`);
  console.log(`launcher: a shadow yaml (imported by a .pth), a fake cryptography and a fake psutil in ${sp}, and a py-certshadow beside az with a shadow knack and a fake nacl, reach a plain python3 but not az (az group list -o yaml from ${SITE}, az keyvault list and az webapp list on az's own py-*); a py-bcrypt of another version and a missing py-cffi are one ERROR line each; AZURE_CLI_SITEPACKAGES=1 puts site-packages back after az's own; TLS works without CURL_CA_BUNDLE (REQUESTS_CA_BUNDLE from SSL_CERT_FILE); a caller REQUESTS_CA_BUNDLE wins`);
}
