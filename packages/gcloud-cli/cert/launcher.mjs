import { ok, sh, PKG, SDK } from './lib/gcloud.mjs';

// bin/gcloud and bin/bq (src/launcher.py) do what Google's shell launchers
// do: CLOUDSDK_ROOT_DIR is this SDK, CLOUDSDK_PYTHON this interpreter, and
// without CLOUDSDK_PYTHON_SITEPACKAGES there is no site-packages on the path
// (python -S), so a py-* package can't shadow the SDK's vendored libraries.
export default async function (ctx) {
  const { assert, write } = ctx;
  const info = JSON.parse((await ok(ctx, 'gcloud info --format=json')).stdout);
  const paths = info.installation.python_path;
  assert.equal(paths[0], `${SDK}/lib/third_party`, paths.join('\n'));
  assert.ok(paths.includes(`${SDK}/lib`), paths.join('\n'));
  assert.ok(!paths.some((p) => p.includes('site-packages')), `site-packages on gcloud's path:\n${paths.join('\n')}`);
  const site = JSON.parse((await ok(ctx, 'CLOUDSDK_PYTHON_SITEPACKAGES=1 gcloud info --format=json')).stdout).installation.python_path;
  assert.ok(site.some((p) => p.includes('site-packages')), `CLOUDSDK_PYTHON_SITEPACKAGES=1 keeps site-packages:\n${site.join('\n')}`);

  // bq runs platform/bq/bq.py in a second python, with -S from
  // CLOUDSDK_PYTHON_ARGS. A .pth in site-packages that reports itself when
  // CLOUDSDK_ROOT_DIR is set (only the launcher's children have it) shows
  // whether that python read site-packages.
  const sp = (await ok(ctx, `python3 -c 'import site; print(site.getsitepackages()[0])'`)).stdout.trim();
  const pth = `${sp}/zz-gcloud-cli-cert.pth`;
  await write(pth, 'import os, sys; os.environ.get("CLOUDSDK_ROOT_DIR") and sys.stderr.write("gcloud-cli-cert: site-packages read\\n")\n');
  try {
    const probe = await sh(ctx, 'CLOUDSDK_ROOT_DIR=/x python3 -c pass');
    assert.match(probe.stderr, /gcloud-cli-cert: site-packages read/, `the .pth probe does not run: ${probe.stderr}`);
    const v = await ok(ctx, 'gcloud version && bq version');
    assert.doesNotMatch(v.stderr, /gcloud-cli-cert/, `gcloud or bq's child python read site-packages:\n${v.stderr}`);
    const leak = await ok(ctx, 'CLOUDSDK_PYTHON_SITEPACKAGES=1 bq version');
    assert.match(leak.stderr, /gcloud-cli-cert: site-packages read/, `CLOUDSDK_PYTHON_SITEPACKAGES=1: bq's child python should read site-packages:\n${leak.stderr}`);
  } finally {
    await sh(ctx, `rm -f '${pth}'`);
  }

  // Invoked under another name, the launcher refuses.
  await ok(ctx, `cp '${PKG}/bin/gcloud' /tmp/gsutil`);
  const other = await sh(ctx, 'python3 /tmp/gsutil version');
  assert.equal(other.status, 1, other.stdout + other.stderr);
  assert.match(other.stderr, /runs only as gcloud or bq/, other.stderr);
  console.log(`launcher: python path starts at ${SDK}/lib/third_party with no site-packages (-S), bq's child python too (a .pth in ${sp} not read); CLOUDSDK_PYTHON_SITEPACKAGES=1 brings them back`);
}
