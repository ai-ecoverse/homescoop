import { ok, readJson, PKG, SDK } from './lib/gcloud.mjs';

// gcloud version lists Google Cloud SDK <release> and the components this
// package installed, at the versions of Google's manifest (.install/, written
// by the SDK's own InstallationManifest at build time); bq version is the
// BigQuery CLI in platform/bq. gcloud info: CPython 3.15 from wasix-python,
// the SDK root and installation properties in this package.
export default async function (ctx) {
  const { assert } = ctx;
  const pkg = await readJson(ctx, `${PKG}/package.json`);
  const release = pkg.homescoop.upstream;
  const want = [`Google Cloud SDK ${release}`];
  for (const id of ['alpha', 'beta', 'bq', 'core']) {
    const snap = await readJson(ctx, `${SDK}/.install/${id}.snapshot.json`);
    assert.equal(snap.version, release, `${id}.snapshot.json is release ${snap.version}`);
    const c = snap.components.find((x) => x.id === id);
    assert.ok(c?.version?.version_string, `${id}.snapshot.json has no version for ${id}`);
    want.push(`${id} ${c.version.version_string}`);
  }
  const v = await ok(ctx, 'gcloud version');
  assert.equal(v.stdout.trim(), want.join('\n'), `gcloud version:\n${v.stdout}${v.stderr}`);
  assert.doesNotMatch(v.stderr, /Updates are available|survey|usage statistics/i, v.stderr);

  const bqVersion = (await ok(ctx, `cat '${SDK}/platform/bq/VERSION'`)).stdout.trim();
  const bq = await ok(ctx, 'bq version');
  assert.equal(bq.stdout.trim(), `This is BigQuery CLI ${bqVersion}`, `bq version:\n${bq.stdout}${bq.stderr}`);

  const info = JSON.parse((await ok(ctx, 'gcloud info --format=json')).stdout);
  assert.match(info.basic.python_version, /^3\.15\./, `python ${info.basic.python_version}`);
  assert.equal(info.basic.version, release);
  assert.equal(info.installation.sdk_root, SDK);
  assert.equal(info.config.paths.installation_properties_path, `${SDK}/properties`);
  console.log(`gcloud version: ${want.join(', ')}; bq version: BigQuery CLI ${bqVersion}; gcloud info: python ${info.basic.python_version.split(' ')[0]}, sdk_root ${SDK}`);
}
