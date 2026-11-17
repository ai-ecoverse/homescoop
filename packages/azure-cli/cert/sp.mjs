import { entraAndArm, fresh, json, ok, served, sh, SUBSCRIPTION, TENANT } from './lib/az.mjs';

const APP = 'cafe0000-0000-4000-8000-00000000a99a';

// Without a person at the keyboard: az login --service-principal with a
// client secret (the client_credentials grant, no native code), then a call
// with that token (az group list) and az account get-access-token, and with
// a federated token (the client_assertion grant). A wrong
// secret is Entra ID's error, cleanly. The parts of az that need native code
// fail with one ERROR line that names the missing package and exit 1, no
// traceback: certificate login (pyOpenSSL), az keyvault (cryptography),
// az webapp (PyNaCl).
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('sp');

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

  await ctx.write('/root/cert.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const native = [
    [`az login --service-principal -u ${APP} --certificate /root/cert.pem --tenant ${TENANT}`, "pyOpenSSL \\(it needs cryptography, native code\\)", 'OpenSSL'],
    ['az keyvault list', 'cryptography \\(native code: Rust and OpenSSL\\)', 'cryptography'],
    ['az webapp list', 'PyNaCl \\(native code: libsodium\\)', 'nacl'],
  ];
  for (const [cmd, what, mod] of native) {
    const r = await sh(ctx, `${cfg} ${cmd}`);
    assert.equal(r.status, 1, `${cmd}: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^ERROR: This command needs ${what}\\. @ai-ecoverse/azure-cli has only pure-Python code, so that it runs on wasix-python, and doesn't include it \\(No module named '${mod}'\\)\\.$`, 'm'), `${cmd}:\n${r.stderr}`);
    assert.match(r.stderr, /packages\/azure-cli\/package#whats-not-available/, r.stderr);
    assert.doesNotMatch(r.stderr, /Traceback|unexpected error/, `${cmd}:\n${r.stderr}`);
  }
  console.log(`az login --service-principal (client secret): client_credentials grant, az group list with the token, az account get-access-token; a federated token; a wrong secret is AADSTS7000215; certificate login, az keyvault list and az webapp list stop with one ERROR line naming pyOpenSSL, cryptography, PyNaCl`);
}
