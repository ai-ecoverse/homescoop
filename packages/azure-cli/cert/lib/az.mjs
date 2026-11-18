// Shared by the azure-cli cert specs: where the package is, a run that fails
// the spec with the command's output when it exits otherwise, and a stand-in
// for Microsoft Entra ID (login.microsoftonline.com), Azure Resource Manager
// (management.azure.com), blob storage and Key Vault behind the kernel's
// proxy.
export const PKG = '/node_modules/@ai-ecoverse/azure-cli';
export const SITE = `${PKG}/lib/azure-cli`;
export const TENANT = '72f988bf-0000-4000-8000-00000000c0de';
export const SUBSCRIPTION = 'aaaa0000-0000-4000-8000-000000000001';
// Azure CLI's own public client (azure/cli/core/auth/identity.py).
export const AZ_CLIENT = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

export async function sh(ctx, script, opts = {}) {
  return ctx.run(['bash', '-c', script], { cwd: '/root', ...opts });
}

export async function ok(ctx, script, opts = {}) {
  const r = await sh(ctx, script, opts);
  ctx.assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return r;
}

export async function json(ctx, script, opts = {}) {
  const r = await ok(ctx, script, opts);
  try {
    return JSON.parse(r.stdout);
  } catch (err) {
    throw new Error(`${script}: not JSON (${err.message}):\n${r.stdout}\n${r.stderr}`);
  }
}

// A fresh az configuration directory for one spec, so specs don't share a
// login or a config.
export function fresh(name) {
  return `AZURE_CONFIG_DIR=/root/.azure-cert-${name}`;
}

// The requests the stand-in has answered, oldest first: { method, url, auth, body }.
export async function served(ctx) {
  const r = await ok(ctx, `python3 -I -c "import os, ssl, urllib.request; print(urllib.request.urlopen('https://mock.test/__log', context=ssl.create_default_context(cafile=os.environ['SSL_CERT_FILE'])).read().decode())"`);
  return JSON.parse(r.stdout);
}

// ctx.serve() responder (self-contained: it runs in the cert page). It answers
// Entra ID's instance and OIDC discovery, device code, and token endpoint
// (device_code, refresh_token and client_credentials grants, with a secret,
// a federated token or a certificate's client assertion; a token for the
// scope https://vault.azure.net/.default ends in -kv) for any tenant; ARM's
// tenant, subscription, resource group and storage account lists, a
// DevTestLab (certlab), creates in cert-rg (the resource as sent), and an
// empty list for any other list; blob storage for one account (certacct);
// and Key Vault's data plane for one vault (certvault: the bearer challenge,
// then secrets set and get, and a key import, with a -kv token). It records every request.
// Anything else is a 404 that names the URL.
export function entraAndArm({ url, method, headers, body }) {
  const TENANT = '72f988bf-0000-4000-8000-00000000c0de';
  const SUB = 'aaaa0000-0000-4000-8000-000000000001';
  const OID = '0b1d0000-0000-4000-8000-0000000000a1';
  const log = (globalThis.azureCliCertLog ||= []);
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body || new Uint8Array());
  const u = new URL(url);
  const reply = (o, status = 200) => ({ status, headers: [['Content-Type', 'application/json; charset=utf-8']], body: JSON.stringify(o) });
  const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  if (u.hostname === 'mock.test' && u.pathname === '/__log') return reply(log);
  const auth = (headers.find(([k]) => k.toLowerCase() === 'authorization') || [])[1] || '';
  log.push({ method, url, auth, body: text });
  const form = new URLSearchParams(text);
  if (u.hostname === 'login.microsoftonline.com') {
    if (u.pathname === '/common/discovery/instance') {
      return reply({
        tenant_discovery_endpoint: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
        'api-version': '1.1',
        metadata: [{ preferred_network: 'login.microsoftonline.com', preferred_cache: 'login.windows.net', aliases: ['login.microsoftonline.com', 'login.windows.net', 'login.microsoft.com', 'sts.windows.net'] }],
      });
    }
    const m = u.pathname.match(/^\/([^/]+)\/(v2\.0\/\.well-known\/openid-configuration|oauth2\/v2\.0\/devicecode|oauth2\/v2\.0\/token)$/);
    if (!m) return reply({ error: 'mock_unknown', url }, 404);
    const base = `https://login.microsoftonline.com/${m[1]}`;
    if (m[2].startsWith('v2.0')) {
      return reply({
        token_endpoint: `${base}/oauth2/v2.0/token`,
        authorization_endpoint: `${base}/oauth2/v2.0/authorize`,
        device_authorization_endpoint: `${base}/oauth2/v2.0/devicecode`,
        issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
        jwks_uri: `${base}/discovery/v2.0/keys`,
        response_types_supported: ['code', 'id_token', 'code id_token', 'id_token token'],
        tenant_region_scope: 'WW',
        cloud_instance_name: 'microsoftonline.com',
        msgraph_host: 'graph.microsoft.com',
      });
    }
    if (m[2] === 'oauth2/v2.0/devicecode') {
      // Entra ID's own wording (checked live on 2026-11-17); az prints the
      // message as it comes.
      return reply({
        user_code: 'SLICC4AZ',
        device_code: 'cert-device-code',
        verification_uri: 'https://login.microsoft.com/device',
        expires_in: 900,
        interval: 1,
        message: 'To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code SLICC4AZ to authenticate.',
      });
    }
    const tid = m[1] === 'organizations' || m[1] === 'common' ? TENANT : m[1];
    const grant = form.get('grant_type');
    const token = `cert-at-${grant.split(':').pop()}-${tid}-${log.length}`;
    if (grant === 'client_credentials') {
      // A token for Key Vault's data plane says so, and the vault stand-in
      // takes no other.
      const kv = /^https:\/\/vault\.azure\.net\/\.default$/.test(form.get('scope') || '') ? '-kv' : '';
      const jwtBearer = form.get('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
      if (jwtBearer && form.get('client_assertion') === 'cert-federated-token') {
        return reply({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: `${token}-federated${kv}` });
      }
      // A certificate's client assertion: a JWT whose header names RS256 and
      // an x5t. Its signature, claims and thumbprint are checked by
      // cert/certificate.mjs in Node, from this log.
      if (jwtBearer) {
        let head = {};
        try {
          head = JSON.parse(atob((form.get('client_assertion') || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        } catch {}
        if (head.alg !== 'RS256' || !head.x5t) return reply({ error: 'invalid_client', error_description: 'AADSTS700027: Client assertion contains an invalid signature.' }, 401);
        return reply({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: `${token}-certificate${kv}` });
      }
      if (form.get('client_secret') !== 'cert-secret') return reply({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, 401);
      return reply({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: `${token}${kv}` });
    }
    if (grant !== 'urn:ietf:params:oauth:grant-type:device_code' && grant !== 'refresh_token') return reply({ error: 'unsupported_grant_type', url }, 400);
    const idToken = [
      b64u(JSON.stringify({ typ: 'JWT', alg: 'none' })),
      b64u(JSON.stringify({ aud: form.get('client_id'), iss: `https://login.microsoftonline.com/${tid}/v2.0`, iat: now, nbf: now, exp: now + 3600, name: 'Cert User', oid: OID, preferred_username: 'cert@example.test', sub: 'cert-sub', tid, ver: '2.0' })),
      '',
    ].join('.');
    return reply({
      token_type: 'Bearer',
      scope: 'https://management.core.windows.net//user_impersonation',
      expires_in: 3599,
      ext_expires_in: 3599,
      access_token: token,
      refresh_token: 'cert-refresh-token',
      id_token: idToken,
      client_info: b64u(JSON.stringify({ uid: OID, utid: tid })),
    });
  }
  if (u.hostname === 'management.azure.com') {
    if (!/^Bearer cert-at-/.test(auth)) return reply({ error: { code: 'AuthenticationFailed', message: 'no cert token' } }, 401);
    if (u.pathname === '/tenants') {
      return reply({ value: [{ id: `/tenants/${TENANT}`, tenantId: TENANT, displayName: 'Cert Tenant', defaultDomain: 'cert.example.test', tenantCategory: 'Home' }] });
    }
    if (u.pathname === '/subscriptions') {
      return reply({ value: [{ id: `/subscriptions/${SUB}`, subscriptionId: SUB, tenantId: TENANT, displayName: 'Cert Subscription', state: 'Enabled', subscriptionPolicies: {}, authorizationSource: 'RoleBased' }] });
    }
    if (u.pathname === `/subscriptions/${SUB}/providers/Microsoft.Storage/storageAccounts`) {
      return reply({ value: [{ id: `/subscriptions/${SUB}/resourceGroups/cert-rg/providers/Microsoft.Storage/storageAccounts/certacct`, name: 'certacct', type: 'Microsoft.Storage/storageAccounts', location: 'westeurope', kind: 'StorageV2', sku: { name: 'Standard_LRS', tier: 'Standard' }, properties: { provisioningState: 'Succeeded', primaryEndpoints: { blob: 'https://certacct.blob.core.windows.net/' } } }] });
    }
    if (u.pathname.toLowerCase() === `/subscriptions/${SUB}/resourcegroups`) {
      return reply({ value: [{ id: `/subscriptions/${SUB}/resourceGroups/cert-rg`, name: 'cert-rg', type: 'Microsoft.Resources/resourceGroups', location: 'westeurope', tags: { from: 'cert' }, properties: { provisioningState: 'Succeeded' } }] });
    }
    if (u.pathname.toLowerCase() === `/subscriptions/${SUB}/resourcegroups/cert-rg`) {
      return reply({ id: `/subscriptions/${SUB}/resourceGroups/cert-rg`, name: 'cert-rg', type: 'Microsoft.Resources/resourceGroups', location: 'westeurope', properties: { provisioningState: 'Succeeded' } });
    }
    // A DevTestLab, certlab, with one gallery image and one virtual network
    // (az lab vm create --generate-ssh-keys).
    const lab = `/subscriptions/${SUB}/resourcegroups/cert-rg/providers/microsoft.devtestlab/labs/certlab`;
    if (method === 'GET' && u.pathname.toLowerCase() === lab) {
      return reply({ id: lab, name: 'certlab', type: 'Microsoft.DevTestLab/labs', location: 'westeurope', properties: { provisioningState: 'Succeeded' } });
    }
    if (method === 'GET' && u.pathname.toLowerCase() === `${lab}/galleryimages`) {
      return reply({ value: [{ id: `${lab}/galleryimages/Ubuntu`, name: 'Ubuntu Server 22.04 LTS', properties: { enabled: true, imageReference: { offer: '0001-com-ubuntu-server-jammy', publisher: 'Canonical', osType: 'Linux', sku: '22_04-lts', version: 'latest' } } }] });
    }
    if (method === 'GET' && u.pathname.toLowerCase() === `${lab}/virtualnetworks`) {
      return reply({ value: [{ id: `${lab}/virtualnetworks/certvnet`, name: 'certvnet', properties: { subnetOverrides: [{ labSubnetName: 'certsubnet', resourceId: `/subscriptions/${SUB}/resourceGroups/cert-rg/providers/Microsoft.Network/virtualNetworks/certvnet/subnets/certsubnet`, useInVmCreationPermission: 'Allow', usePublicIpAddressPermission: 'Allow' }] } }] });
    }
    if (method === 'POST' && u.pathname.toLowerCase() === `${lab}/createenvironment`) return { status: 200, headers: [], body: '' };
    // A create in cert-rg (az aks create): the resource as
    // sent, provisioned at once.
    const created = u.pathname.match(new RegExp(`^/subscriptions/${SUB}/resourceGroups/cert-rg/providers/(.+)$`, 'i'));
    if (method === 'PUT' && created) {
      let b = {};
      try { b = JSON.parse(text); } catch {}
      return reply({ ...b, id: u.pathname, name: u.pathname.split('/').pop(), type: created[1].split('/').slice(0, -1).filter((_, i) => i % 2 === 0).join('/'), properties: { ...(b.properties || {}), provisioningState: 'Succeeded' } }, 201);
    }
    // Any other list (az keyvault list, az webapp list, ...): empty.
    if (method === 'GET' && !/\/(resourceGroups\/[^/]+\/providers\/[^/]+\/[^/]+\/[^/]+)$/i.test(u.pathname)) return reply({ value: [] });
  }
  // Key Vault's data plane, vault certvault: a request without a token gets
  // the bearer challenge (the SDK's first request, with no body), then
  // secrets set and get with a Key Vault token.
  if (u.hostname === 'certvault.vault.azure.net') {
    if (!/^Bearer cert-at-.*-kv$/.test(auth)) {
      return { status: 401, headers: [['Content-Type', 'application/json; charset=utf-8'], ['WWW-Authenticate', `Bearer authorization="https://login.microsoftonline.com/${TENANT}", resource="https://vault.azure.net"`]], body: JSON.stringify({ error: { code: 'Unauthorized', message: 'AKV10000: Request is missing a Bearer or PoP token.' } }) };
    }
    const secrets = (globalThis.azureCliCertSecrets ||= {});
    // az keyvault key import: the key as a JWK (the public half back).
    const k = u.pathname.match(/^\/keys\/([A-Za-z0-9-]+)$/);
    if (k && method === 'PUT' && u.searchParams.get('api-version')) {
      let b = {};
      try { b = JSON.parse(text); } catch {}
      if (!b.key || b.key.kty !== 'RSA' || !b.key.d) return reply({ error: { code: 'BadParameter', message: 'no RSA private key' } }, 400);
      return reply({ key: { kid: `https://certvault.vault.azure.net/keys/${k[1]}/0cafe${String(log.length).padStart(27, '0')}`, kty: 'RSA', key_ops: ['encrypt', 'decrypt', 'sign', 'verify', 'wrapKey', 'unwrapKey'], n: b.key.n, e: b.key.e }, attributes: { enabled: true, created: 1794823200, updated: 1794823200, recoveryLevel: 'Recoverable+Purgeable', recoverableDays: 90, exportable: false }, tags: {} });
    }
    const m = u.pathname.match(/^\/secrets\/([A-Za-z0-9-]+)\/?([0-9a-f]*)$/);
    if (!m || !u.searchParams.get('api-version')) return reply({ error: { code: 'BadParameter', message: `cert stand-in: ${method} ${url}` } }, 400);
    const bundle = (s) => ({ value: s.value, id: `https://certvault.vault.azure.net/secrets/${m[1]}/${s.version}`, attributes: { enabled: true, created: 1794823200, updated: 1794823200, recoveryLevel: 'Recoverable+Purgeable', recoverableDays: 90 }, ...(s.contentType ? { contentType: s.contentType } : {}), tags: s.tags || {} });
    if (method === 'PUT' && !m[2]) {
      let b = {};
      try { b = JSON.parse(text); } catch {}
      if (typeof b.value !== 'string') return reply({ error: { code: 'BadParameter', message: 'no value' } }, 400);
      secrets[m[1]] = { value: b.value, contentType: b.contentType, tags: b.tags, version: `0cafe${String(log.length).padStart(27, '0')}` };
      return reply(bundle(secrets[m[1]]));
    }
    if (method === 'GET') {
      if (!secrets[m[1]]) return reply({ error: { code: 'SecretNotFound', message: `A secret with (name/id) ${m[1]} was not found in this key vault.` } }, 404);
      return reply(bundle(secrets[m[1]]));
    }
  }
  // Blob storage, account certacct, container c: list, upload (Put Blob)
  // and download (ranged Get Blob), shared-key requests only.
  if (u.hostname === 'certacct.blob.core.windows.net') {
    if (!/^SharedKey certacct:[A-Za-z0-9+/=]+$/.test(auth)) return { status: 403, headers: [['Content-Type', 'application/xml']], body: '<?xml version="1.0" encoding="utf-8"?><Error><Code>AuthenticationFailed</Code><Message>no shared key</Message></Error>' };
    const blobs = (globalThis.azureCliCertBlobs ||= { 'hello.txt': 'hello from the cert\n' });
    const date = 'Mon, 16 Nov 2026 10:00:00 GMT';
    const xml = (b, status = 200, extra = []) => ({ status, headers: [['Content-Type', 'application/xml'], ['x-ms-version', '2025-01-05'], ...extra], body: `<?xml version="1.0" encoding="utf-8"?>${b}` });
    const name = decodeURIComponent(u.pathname.replace(/^\/c\/?/, ''));
    if (u.pathname === '/c' && u.searchParams.get('comp') === 'list') {
      const items = Object.entries(blobs).map(([n, t]) => `<Blob><Name>${n}</Name><Properties><Creation-Time>${date}</Creation-Time><Last-Modified>${date}</Last-Modified><Etag>0x8DCERT</Etag><Content-Length>${new TextEncoder().encode(t).length}</Content-Length><Content-Type>text/plain</Content-Type><BlobType>BlockBlob</BlobType><AccessTier>Hot</AccessTier><LeaseStatus>unlocked</LeaseStatus><LeaseState>available</LeaseState><ServerEncrypted>true</ServerEncrypted></Properties><OrMetadata /></Blob>`).join('');
      return xml(`<EnumerationResults ServiceEndpoint="https://certacct.blob.core.windows.net/" ContainerName="c"><Blobs>${items}</Blobs><NextMarker /></EnumerationResults>`);
    }
    if (name && method === 'PUT') {
      blobs[name] = text;
      return { status: 201, headers: [['ETag', '"0x8DCERT"'], ['Last-Modified', date], ['x-ms-request-server-encrypted', 'true'], ['x-ms-version', '2025-01-05']], body: '' };
    }
    if (name && (method === 'GET' || method === 'HEAD')) {
      if (!(name in blobs)) return xml('<Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.</Message></Error>', 404, [['x-ms-error-code', 'BlobNotFound']]);
      const bytes = new TextEncoder().encode(blobs[name]);
      const common = [['Content-Type', 'text/plain'], ['ETag', '"0x8DCERT"'], ['Last-Modified', date], ['x-ms-blob-type', 'BlockBlob'], ['x-ms-creation-time', date], ['x-ms-lease-state', 'available'], ['x-ms-lease-status', 'unlocked'], ['x-ms-server-encrypted', 'true'], ['x-ms-version', '2025-01-05'], ['Accept-Ranges', 'bytes']];
      const range = (headers.find(([k]) => k.toLowerCase() === 'x-ms-range') || [])[1];
      if (method === 'GET' && range) {
        const [, a, b] = range.match(/bytes=(\d+)-(\d*)/);
        const end = Math.min(bytes.length - 1, b ? Number(b) : bytes.length - 1);
        const part = bytes.slice(Number(a), end + 1);
        return { status: 206, headers: [...common, ['Content-Length', String(part.length)], ['Content-Range', `bytes ${a}-${end}/${bytes.length}`]], body: part };
      }
      return { status: 200, headers: [...common, ['Content-Length', String(bytes.length)]], body: method === 'HEAD' ? '' : bytes };
    }
  }
  return reply({ error: 'mock_unknown', url }, 404);
}
