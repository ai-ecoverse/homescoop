import { entraAndArm, fresh, json, ok, served, sh, AZ_CLIENT, SUBSCRIPTION, TENANT } from './lib/az.mjs';

// az login --use-device-code, the sign-in that fits slicc: no browser and no
// localhost redirect. az asks Entra ID (a stand-in behind the kernel's proxy,
// over TLS with the kernel's CA) for a device code with its own client id,
// prints Entra ID's "open https://login.microsoft.com/device and enter the
// code" message, polls the token endpoint, then lists the tenants and
// subscriptions with the token. After that az account show, az group list and
// az account get-access-token work from the cached login, and the MSAL token
// cache is a plain JSON file only its owner can read. Plain az login takes the
// same flow by itself: Python finds no browser in slicc, and with
// can-launch-browser-wasi.patch az checks for one on WASI as on Linux.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('device');

  // timeout: without the patch, az waits for a browser redirect that never comes.
  const plain = await sh(ctx, `${fresh('plain')} timeout 180 az login --output none </dev/null`);
  assert.equal(plain.status, 0, `az login: rc=${plain.status}\n${plain.stderr}`);
  assert.match(plain.stderr, /open the page https:\/\/login\.microsoft\.com\/device and enter the code SLICC4AZ/, plain.stderr);
  assert.doesNotMatch(plain.stderr, /web browser has been opened|localhost|127\.0\.0\.1/, plain.stderr);
  assert.equal((await json(ctx, `${fresh('plain')} az account show`)).id, SUBSCRIPTION);

  const login = await sh(ctx, `${cfg} az login --use-device-code --output json </dev/null`);
  assert.equal(login.status, 0, `az login --use-device-code: rc=${login.status}\n${login.stdout}\n${login.stderr}`);
  assert.match(login.stderr, /To sign in, use a web browser to open the page https:\/\/login\.microsoft\.com\/device and enter the code SLICC4AZ to authenticate\./, login.stderr);
  assert.doesNotMatch(`${login.stdout}${login.stderr}`, /localhost|127\.0\.0\.1|Traceback/, login.stderr);
  const subs = JSON.parse(login.stdout);
  assert.deepEqual(subs.map((s) => [s.id, s.tenantId, s.isDefault, s.user]), [[SUBSCRIPTION, TENANT, true, { name: 'cert@example.test', type: 'user' }]], login.stdout);

  const log = await served(ctx);
  const device = log.find((r) => r.url === 'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode');
  assert.ok(device, `no device code request:\n${log.map((r) => `${r.method} ${r.url}`).join('\n')}`);
  const q = new URLSearchParams(device.body);
  assert.equal(q.get('client_id'), AZ_CLIENT);
  assert.ok(q.get('scope').split(' ').includes('https://management.core.windows.net//.default'), q.get('scope'));
  const poll = log.find((r) => r.url.endsWith('/organizations/oauth2/v2.0/token') && new URLSearchParams(r.body).get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(new URLSearchParams(poll?.body).get('device_code'), 'cert-device-code', 'az polled the token endpoint with the device code');
  const arm = log.filter((r) => r.url.startsWith('https://management.azure.com/'));
  assert.ok(arm.length >= 2 && arm.every((r) => /^Bearer cert-at-/.test(r.auth)), `ARM calls without the token:\n${JSON.stringify(arm, null, 1)}`);

  const account = await json(ctx, `${cfg} az account show`);
  assert.equal(account.id, SUBSCRIPTION);
  assert.equal(account.user.name, 'cert@example.test');
  const groups = await json(ctx, `${cfg} az group list`);
  assert.deepEqual(groups.map((g) => [g.name, g.location, g.properties.provisioningState]), [['cert-rg', 'westeurope', 'Succeeded']]);
  const after = await served(ctx);
  const list = after.slice(log.length).find((r) => /\/subscriptions\/[^/]+\/resourcegroups\?/i.test(r.url));
  assert.ok(list?.url.startsWith(`https://management.azure.com/subscriptions/${SUBSCRIPTION}/resourcegroups?api-version=`), JSON.stringify(list));
  assert.match(list.auth, /^Bearer cert-at-(device_code|refresh_token)-/, list.auth);

  const token = await json(ctx, `${cfg} az account get-access-token`);
  assert.match(token.accessToken, /^cert-at-(device_code|refresh_token)-/, JSON.stringify(token));
  assert.equal(token.tenant, TENANT);
  assert.equal(token.subscription, SUBSCRIPTION);
  assert.equal(token.tokenType, 'Bearer');

  // Plain JSON, mode 0600 (no keyring on wasix), and no encrypted .bin.
  const cache = await ok(ctx, `cd /root/.azure-cert-device && stat -c '%a %n' msal_token_cache.* && ls`);
  assert.match(cache.stdout, /^600 msal_token_cache\.json$/m, cache.stdout);
  assert.doesNotMatch(cache.stdout, /msal_token_cache\.bin/, cache.stdout);
  const cached = JSON.parse((await ok(ctx, 'cat /root/.azure-cert-device/msal_token_cache.json')).stdout);
  assert.ok(Object.values(cached.RefreshToken || {}).some((t) => t.secret === 'cert-refresh-token'), 'the refresh token is in the plain cache');

  const out = await ok(ctx, `${cfg} az logout && ${cfg} az account list`);
  assert.deepEqual(JSON.parse(out.stdout), [], out.stdout);
  console.log(`az login (no browser: device code) and az login --use-device-code: Entra ID's login.microsoft.com/device message and code printed, token polled, ${arm.length} ARM calls with the token; az account show, az group list (cert-rg), az account get-access-token; msal_token_cache.json 0600; az logout`);
}
