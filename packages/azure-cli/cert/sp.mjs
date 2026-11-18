import { entraAndArm, fresh, json, ok, served, sh, SUBSCRIPTION, TENANT } from './lib/az.mjs';

const APP = 'cafe0000-0000-4000-8000-00000000a99a';

// Without a person at the keyboard: az login --service-principal with a
// client secret (the client_credentials grant, no native code), then a call
// with that token (az group list) and az account get-access-token, and with
// a federated token (the client_assertion grant). A wrong
// secret is Entra ID's error, cleanly. A certificate is cert/certificate.mjs.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('sp');
  await ok(ctx, 'rm -rf /root/.azure-cert-sp /root/.azure-cert-sp-federated');

  const bad = await sh(ctx, `${cfg} az login --service-principal -u ${APP} -p wrong --tenant ${TENANT}`);
  assert.equal(bad.status, 1, `wrong secret: rc=${bad.status}\n${bad.stderr}`);
  assert.match(bad.stderr, /AADSTS7000215: Invalid client secret provided/, bad.stderr);
  assert.doesNotMatch(bad.stderr, /Traceback|unexpected error/, bad.stderr);

  const before = (await served(ctx)).length;
  const subs = await json(ctx, `${cfg} az login --service-principal -u ${APP} -p cert-secret --tenant ${TENANT}`);
  assert.deepEqual(subs.map((s) => [s.id, s.tenantId, s.user]), [[SUBSCRIPTION, TENANT, { name: APP, type: 'servicePrincipal' }]], JSON.stringify(subs));
  const log = (await served(ctx)).slice(before);
  const grant = log.find((r) => r.url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
  const form = new URLSearchParams(grant?.body || '');
  assert.equal(form.get('grant_type'), 'client_credentials', JSON.stringify(grant));
  assert.equal(form.get('client_id'), APP);
  assert.equal(form.get('client_secret'), 'cert-secret');

  const groups = await json(ctx, `${cfg} az group list --query "[].{name:name, tags:tags}"`);
  assert.deepEqual(groups, [{ name: 'cert-rg', tags: { from: 'cert' } }]);
  const arm = (await served(ctx)).filter((r) => /\/resourcegroups\?/i.test(r.url)).pop();
  assert.match(arm.auth, /^Bearer cert-at-client_credentials-/, arm.auth);
  const token = await json(ctx, `${cfg} az account get-access-token`);
  assert.match(token.accessToken, /^cert-at-client_credentials-/);
  assert.equal(token.tenant, TENANT);
  // The service principal's secret is kept as upstream keeps it on Linux: in
  // the plain service_principal_entries.json, mode 0600.
  const entries = await ok(ctx, "stat -c '%a' /root/.azure-cert-sp/service_principal_entries.json");
  assert.equal(entries.stdout.trim(), '600');

  // A federated token (workload identity): the client_assertion grant.
  const fcfg = fresh('sp-federated');
  const fed = await json(ctx, `${fcfg} az login --service-principal -u ${APP} --federated-token cert-federated-token --tenant ${TENANT}`);
  assert.equal(fed[0]?.id, SUBSCRIPTION, JSON.stringify(fed));
  assert.match((await json(ctx, `${fcfg} az account get-access-token`)).accessToken, /^cert-at-client_credentials-.*-federated$/);

  console.log(`az login --service-principal (client secret): client_credentials grant, az group list with the token, az account get-access-token; a federated token; a wrong secret is AADSTS7000215`);
}
