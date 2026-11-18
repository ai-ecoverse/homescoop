import { entraAndArm, fresh, json, ok, served, sh, SITE } from './lib/az.mjs';

const KEY = Buffer.from('homescoop azure-cli cert account key').toString('base64');

// az storage, with cryptography: azure-storage-blob, -queue and -common
// import it at module level for client-side encryption (2.93.0-1 patched
// that out, storage-encryption-without-cryptography.patch; with
// py-cryptography the SDKs load unpatched). The storage module's arguments
// load and az storage account list (ARM) works, and the blob data plane with
// an account key: list, upload and download against a stand-in for
// certacct.blob.core.windows.net, every request signed with SharedKey (hmac
// from Python's stdlib). In az's own tree, the unpatched _encryption modules
// encrypt and decrypt with AES (CBC and GCM) on py-cryptography.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('storage');
  await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
  const accounts = await json(ctx, `${cfg} az storage account list`);
  assert.deepEqual(accounts.map((a) => [a.name, a.kind, a.sku.name]), [['certacct', 'StorageV2', 'Standard_LRS']], JSON.stringify(accounts));

  const auth = `--account-name certacct --account-key ${KEY}`;
  const list = await json(ctx, `${cfg} az storage blob list -c c ${auth}`);
  assert.deepEqual(list.map((b) => [b.name, b.properties.contentLength]), [['hello.txt', 20]], JSON.stringify(list));
  await ctx.write('/root/upload.txt', 'uploaded from slicc\n');
  await ok(ctx, `${cfg} az storage blob upload -c c -n up.txt -f /root/upload.txt ${auth} -o none`);
  await ok(ctx, `${cfg} az storage blob download -c c -n up.txt -f /root/down.txt ${auth} -o none`);
  assert.equal(await ctx.read('/root/down.txt'), 'uploaded from slicc\n');
  const names = (await json(ctx, `${cfg} az storage blob list -c c ${auth} --query "[].name"`)).sort();
  assert.deepEqual(names, ['hello.txt', 'up.txt']);
  const blob = (await served(ctx)).filter((r) => r.url.startsWith('https://certacct.blob.core.windows.net/'));
  assert.ok(blob.length >= 4 && blob.every((r) => /^SharedKey certacct:/.test(r.auth)), JSON.stringify(blob.map((r) => [r.method, r.url, r.auth])));
  assert.ok(blob.some((r) => r.method === 'PUT' && r.url.startsWith('https://certacct.blob.core.windows.net/c/up.txt')), 'Put Blob');

  // The unpatched modules: client-side encryption on py-cryptography, in a
  // python with az's tree and the py-* packages (discovery) on its path.
  const probe = await sh(ctx, `python3 -I -c "
import sys; sys.path.insert(0, '${SITE}')
import os, inspect
import azure.storage.blob._encryption as b, azure.storage.queue._encryption as q, azure.storage.common._encryption as c
import cryptography
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
print(cryptography.__file__)
for m in (b, q, c):
    src = inspect.getsource(m)
    print(m.__name__, 'homescoop' in src, '\\nfrom cryptography' in src)
key, iv = os.urandom(32), os.urandom(16)
for m in (b, q):
    enc = m._generate_AES_CBC_cipher(key, iv).encryptor()
    ct = enc.update(b'0123456789abcdef') + enc.finalize()
    dec = m._generate_AES_CBC_cipher(key, iv).decryptor()
    print(m.__name__, dec.update(ct) + dec.finalize() == b'0123456789abcdef', ct != b'0123456789abcdef')
nonce = os.urandom(12)
print('gcm', AESGCM(key).decrypt(nonce, AESGCM(key).encrypt(nonce, b'slicc', None), None) == b'slicc')
"`);
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(probe.stdout.trim().split('\n'), [
    '/node_modules/@ai-ecoverse/py-cryptography/lib/python3.15/site-packages/cryptography/__init__.py',
    'azure.storage.blob._encryption False True',
    'azure.storage.queue._encryption False True',
    'azure.storage.common._encryption False True',
    'azure.storage.blob._encryption True True',
    'azure.storage.queue._encryption True True',
    'gcm True',
  ], probe.stdout + probe.stderr);
  console.log('az storage account list (ARM); az storage blob list, upload and download with an account key (SharedKey) against certacct; the unpatched storage SDKs import cryptography at module level and their client-side encryption ciphers work on py-cryptography');
}
