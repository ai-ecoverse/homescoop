import { sh } from './lib/gcloud.mjs';

// The component manager is off (core/config.json disable_updater, as in
// Google's apt and yum packages): install, update and remove stop
// with Google's "external package manager" error and exit 1, and change
// nothing.
export default async function (ctx) {
  const { assert } = ctx;
  const before = (await sh(ctx, 'ls /node_modules/@ai-ecoverse/gcloud-cli/lib/google-cloud-sdk/.install')).stdout;
  for (const cmd of ['install kubectl', 'update', 'remove bq']) {
    const r = await sh(ctx, `gcloud components ${cmd} --quiet`);
    assert.equal(r.status, 1, `gcloud components ${cmd}: rc=${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /You cannot perform this action because this Google Cloud CLI installation is managed by an external package manager/, `gcloud components ${cmd}: ${r.stderr}`);
  }
  const after = (await sh(ctx, 'ls /node_modules/@ai-ecoverse/gcloud-cli/lib/google-cloud-sdk/.install')).stdout;
  assert.equal(after, before, '.install/ is unchanged');
  console.log('gcloud components install/update/remove: refused (managed by an external package manager), rc 1');
}
