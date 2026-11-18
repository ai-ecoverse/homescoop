// Shared by the azure-cli cert specs: where the package is, a run that fails
// the spec with the command's output when it exits otherwise, and a stand-in
// for Microsoft Entra ID (login.microsoftonline.com) and Azure Resource
// Manager (management.azure.com) behind the kernel's proxy.
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
// Entra ID's instance and OIDC discovery, device code, and token endpoint (device_code,
// refresh_token and client_credentials grants, with a secret or a federated
// token) for any tenant, and ARM's
// tenant, subscription, resource group and storage account lists, and blob
// storage for one account, and records every request.
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
      if (form.get('client_assertion') === 'cert-federated-token' && form.get('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
        return reply({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: `${token}-federated` });
      }
      if (form.get('client_secret') !== 'cert-secret') return reply({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, 401);
      return reply({ token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: token });
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
