import { generateKeyPairSync } from 'node:crypto';
import { entraAndArm, fresh, json, ok, served, TENANT } from './lib/az.mjs';

const APP = 'cafe0000-0000-4000-8000-00000000a99a';
const VAULT = 'https://certvault.vault.azure.net';

// az keyvault (cryptography at import) against a stand-in for the data plane
// of certvault.vault.azure.net: az keyvault secret set and show, with Key
// Vault's bearer challenge. The SDK's first request goes without a token and
// without its body; the stand-in answers 401 with the challenge
// (authorization = the tenant, resource = https://vault.azure.net); az then
// asks Entra ID for a token for https://vault.azure.net/.default (the
// client_credentials grant of the service principal) and sends the request
// again with it, as JSON with an api-version. The stand-in takes no other
// token, and the value comes back from az keyvault secret show. az keyvault
// key import (keyvault's custom.py, which imports cryptography at module
// level) reads an RSA PEM made in Node with cryptography and sends it as a
// JWK: n, e, d, p, q, dp, dq and qi are Node's own for that key.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('keyvault');
  await ok(ctx, 'rm -rf /root/.azure-cert-keyvault');
  await ok(ctx, `${cfg} az login --service-principal -u ${APP} -p cert-secret --tenant ${TENANT} -o none`);
  const before = (await served(ctx)).length;
  const set = await json(ctx, `${cfg} az keyvault secret set --vault-name certvault -n cert-secret-1 --value 'hunter2 from slicc' --content-type text/plain`);
  assert.equal(set.name, 'cert-secret-1', JSON.stringify(set));
  assert.equal(set.value, 'hunter2 from slicc');
  assert.match(set.id, /^https:\/\/certvault\.vault\.azure\.net\/secrets\/cert-secret-1\/0cafe[0-9]{27}$/, set.id);
  assert.equal(set.contentType, 'text/plain');
  assert.equal(set.attributes.enabled, true);

  const log = (await served(ctx)).slice(before);
  const vault = log.filter((r) => r.url.startsWith(`${VAULT}/`));
  const [first, ...rest] = vault;
  // The challenge: no token, and no body yet.
  assert.match(first.url, /^https:\/\/certvault\.vault\.azure\.net\/secrets\/cert-secret-1\?api-version=7\.\d+(-preview)?$/, first.url);
  assert.equal(first.method, 'PUT');
  assert.equal(first.auth, '', JSON.stringify(first));
  assert.equal(first.body, '', JSON.stringify(first));
  const grant = log.find((r) => r.url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token` && new URLSearchParams(r.body).get('scope')?.startsWith('https://vault.azure.net/'));
  assert.ok(grant, `no token request for Key Vault:\n${JSON.stringify(log.map((r) => [r.method, r.url]))}`);
  const form = new URLSearchParams(grant.body);
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), APP);
  assert.equal(form.get('scope'), 'https://vault.azure.net/.default');
  assert.ok(log.indexOf(grant) > log.indexOf(first), 'the token is asked for after the challenge');
  // The real request: signed with the Key Vault token, the secret as JSON.
  const put = rest.find((r) => r.method === 'PUT');
  assert.equal(put.url, first.url);
  assert.match(put.auth, /^Bearer cert-at-client_credentials-72f988bf-0000-4000-8000-00000000c0de-\d+-kv$/, put.auth);
  const body = JSON.parse(put.body);
  assert.equal(body.value, 'hunter2 from slicc');
  assert.equal(body.contentType, 'text/plain');

  const shown = await json(ctx, `${cfg} az keyvault secret show --vault-name certvault -n cert-secret-1`);
  assert.equal(shown.value, 'hunter2 from slicc');
  assert.equal(shown.id, set.id);
  const get = (await served(ctx)).filter((r) => r.url.startsWith(`${VAULT}/secrets/cert-secret-1/`) && r.method === 'GET').pop();
  assert.match(get.url, /^https:\/\/certvault\.vault\.azure\.net\/secrets\/cert-secret-1\/\?api-version=7\.\d+(-preview)?$/, get.url);
  assert.match(get.auth, /-kv$/, get.auth);
  // az keyvault key import --pem-file: cryptography reads the key.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await ctx.write('/root/kv-key.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const imported = await json(ctx, `${cfg} az keyvault key import --vault-name certvault -n cert-key-1 --pem-file /root/kv-key.pem`);
  const jwk = privateKey.export({ format: 'jwk' });
  // az prints the key bytes back as base64 (Node's decoder takes either alphabet).
  assert.equal(Buffer.from(imported.key.n, 'base64').toString('hex'), Buffer.from(jwk.n, 'base64url').toString('hex'), `n: ${imported.key.n}`);
  const keyPut = (await served(ctx)).filter((r) => r.method === 'PUT' && r.url.startsWith(`${VAULT}/keys/cert-key-1?`)).pop();
  assert.ok(keyPut, 'no key import request');
  assert.match(keyPut.auth, /-kv$/, keyPut.auth);
  const sent = JSON.parse(keyPut.body).key;
  assert.equal(sent.kty, 'RSA');
  for (const f of ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) {
    assert.equal(Buffer.from(sent[f], 'base64url').toString('hex'), Buffer.from(jwk[f], 'base64url').toString('hex'), `JWK ${f}`);
  }
  assert.match(imported.key.kid, /^https:\/\/certvault\.vault\.azure\.net\/keys\/cert-key-1\/0cafe[0-9]{27}$/, imported.key.kid);
  console.log(`az keyvault key import --pem-file: the PUT carries the RSA key as a JWK equal to Node's; az keyvault secret set: a challenge PUT with no token or body, a client_credentials token for https://vault.azure.net/.default, then the PUT ${first.url.split('?')[1]} with {value, contentType} and that Bearer token; az keyvault secret show reads the value back`);
}
