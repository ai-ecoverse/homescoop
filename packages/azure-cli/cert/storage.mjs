import { entraAndArm, fresh, json, ok, served, sh, SITE } from './lib/az.mjs';

const KEY = Buffer.from('homescoop azure-cli cert account key').toString('base64');

// az storage without cryptography (storage-encryption-without-cryptography.patch):
// azure-storage-blob, -queue and -common import it only for client-side
// encryption, and with the patch they load without it. So the storage
// module's arguments load and az storage account list (ARM) works, and the
// blob data plane with an account key: list, upload and download against a
// stand-in for certacct.blob.core.windows.net, every request signed with
// SharedKey (hmac from Python's stdlib). Client-side encryption itself, which
// az doesn't offer, raises an ImportError for cryptography.
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

  // The patched modules, and what client-side encryption does without cryptography.
  const probe = await sh(ctx, `python3 -I -c "
import sys; sys.path.insert(0, '${SITE}')
import azure.storage.blob._encryption as b, azure.storage.queue._encryption as q, azure.storage.common._encryption as c
for m in (b, q):
    try:
        m._generate_AES_CBC_cipher(b'0' * 32, b'0' * 16)
    except ImportError as e:
        print(m.__name__, type(e).__name__, e.name)
"`);
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(probe.stdout.trim().split('\n'), [
    'azure.storage.blob._encryption ModuleNotFoundError cryptography',
    'azure.storage.queue._encryption ModuleNotFoundError cryptography',
  ], probe.stdout + probe.stderr);
  console.log('az storage account list (ARM); az storage blob list, upload and download with an account key (SharedKey) against certacct; client-side encryption raises ModuleNotFoundError for cryptography');
}
