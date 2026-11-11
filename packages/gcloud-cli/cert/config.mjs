import { ok, sh } from './lib/gcloud.mjs';

// gcloud config list shows the installation's properties (no update checks,
// no usage reporting, no survey prompts) and the kernel's CA as
// core/custom_ca_certs_file (the launcher sets it from SSL_CERT_FILE, for
// bq's httplib2). gcloud config set writes the user's configuration under
// $HOME/.config/gcloud, and a user's setting wins over the installation's.
export default async function (ctx) {
  const { assert } = ctx;
  const ca = (await ok(ctx, 'printf %s "$SSL_CERT_FILE"')).stdout;
  assert.ok(ca, 'the kernel sets SSL_CERT_FILE');
  const list = await ok(ctx, 'gcloud config list --format=json');
  const props = JSON.parse(list.stdout);
  assert.deepEqual(props, {
    component_manager: { disable_update_check: 'True' },
    core: { custom_ca_certs_file: ca, disable_usage_reporting: 'True' },
    survey: { disable_prompts: 'True' },
  }, list.stdout);
  const text = await ok(ctx, 'gcloud config list');
  assert.match(text.stderr, /Your active configuration is: \[default\]/, text.stderr);

  await ok(ctx, 'gcloud config set project homescoop-cert-test');
  await ok(ctx, 'gcloud config set core/disable_usage_reporting false');
  const p = await ok(ctx, 'gcloud config get project');
  assert.equal(p.stdout.trim(), 'homescoop-cert-test');
  const after = JSON.parse((await ok(ctx, 'gcloud config list --format=json')).stdout);
  assert.equal(after.core.project, 'homescoop-cert-test');
  assert.equal(after.core.disable_usage_reporting, 'false', 'the user configuration overrides the installation properties');
  const file = await ok(ctx, 'cat "$HOME/.config/gcloud/configurations/config_default"');
  assert.match(file.stdout, /^project = homescoop-cert-test$/m, file.stdout);
  // Without SSL_CERT_FILE the launcher leaves the property alone.
  const bare = await sh(ctx, 'env -u SSL_CERT_FILE gcloud config get core/custom_ca_certs_file');
  assert.equal(bare.stdout.trim(), '', `custom_ca_certs_file without SSL_CERT_FILE: ${bare.stdout}${bare.stderr}`);
  console.log(`gcloud config: installation properties set, custom_ca_certs_file ${ca}, config set project / core property land in ~/.config/gcloud and win`);
}
