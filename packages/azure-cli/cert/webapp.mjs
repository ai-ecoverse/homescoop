import { entraAndArm, fresh, json, ok, served } from './lib/az.mjs';
import { installProbe } from './lib/probe.mjs';

// A repository's Actions public key and its private half, made with PyNaCl
// by a plain python3 (discovery), the way GitHub's API hands out the public
// one (base64 of the 32-byte X25519 key).
const KEYPAIR = `
import base64
from nacl.public import PrivateKey
k = PrivateKey.generate()
open("/root/gh-actions.key", "wb").write(bytes(k))
print(base64.b64encode(bytes(k.public_key)).decode())
`;
const OPEN = `
import base64, sys
from nacl.public import PrivateKey, SealedBox
sealed = base64.b64decode(open(sys.argv[1]).read())
print(len(sealed))
sys.stdout.write(SealedBox(PrivateKey(open("/root/gh-actions.key", "rb").read())).decrypt(sealed).decode())
`;

// az webapp deployment github-actions add stores the app's publish profile
// as a GitHub Actions secret, sealed for the repository's public key with
// PyNaCl (appservice's _encrypt_github_actions_secret, which az webapp and
// az functionapp import PyNaCl for at module level). Here az's own function
// seals a publish profile in az's process (an extension's probe, with the
// sys.path bin/az made), and a plain python3 opens the sealed box with the
// private key: the text comes back, and the box is crypto_box_seal's
// (an ephemeral public key and a MAC more than the text, new each time). az
// webapp list against ARM works too (PyNaCl and fabric at import).
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('webapp');
  await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
  const before = (await served(ctx)).length;
  assert.deepEqual(await json(ctx, `${cfg} az webapp list`), []);
  const list = (await served(ctx)).slice(before).find((r) => /\/providers\/Microsoft\.Web\/sites\?/i.test(r.url));
  assert.ok(list && /^Bearer cert-at-/.test(list.auth), `az webapp list: ${JSON.stringify(list)}`);

  await installProbe(ctx, '/root/.azure-cert-webapp');
  await ctx.write('/root/gh-keypair.py', KEYPAIR);
  await ctx.write('/root/gh-open.py', OPEN);
  const pub = (await ok(ctx, 'python3 -I /root/gh-keypair.py')).stdout.trim();
  assert.equal(Buffer.from(pub, 'base64').length, 32, pub);
  const profile = '<publishData><publishProfile profileName="certapp - Web Deploy" publishMethod="MSDeploy" userPWD="s3cr3t &amp; more" /></publishData>';
  await ctx.write('/root/profile.xml', profile);
  const seal = async (out) => {
    const r = await json(ctx, `${cfg} az certprobe seal --public-key '${pub}' --value "$(cat /root/profile.xml)"`);
    await ctx.write(out, r.encrypted_value);
    return r.encrypted_value;
  };
  const one = await seal('/root/sealed-1.b64');
  const two = await seal('/root/sealed-2.b64');
  assert.notEqual(one, two, 'a sealed box is new each time (ephemeral key)');
  for (const f of ['/root/sealed-1.b64', '/root/sealed-2.b64']) {
    const opened = await ok(ctx, `python3 -I /root/gh-open.py ${f}`);
    const [len, ...text] = opened.stdout.split('\n');
    assert.equal(text.join('\n'), profile, opened.stdout);
    // crypto_box_SEALBYTES: the 32-byte ephemeral public key and the 16-byte MAC.
    assert.equal(Number(len), Buffer.byteLength(profile) + 48, opened.stdout);
  }
  // Another key can't open it.
  const wrong = await ctx.run(['bash', '-c', 'python3 -I /root/gh-keypair.py > /dev/null && python3 -I /root/gh-open.py /root/sealed-1.b64'], { cwd: '/root' });
  assert.equal(wrong.status, 1, wrong.stdout);
  assert.match(wrong.stderr, /nacl\.exceptions\.CryptoError: An error occurred trying to decrypt the message/, wrong.stderr);
  console.log(`az webapp list (ARM); appservice's _encrypt_github_actions_secret in az's process seals a ${Buffer.byteLength(profile)}-byte publish profile for a PyNaCl X25519 public key; a plain python3 opens both boxes (${Buffer.byteLength(profile) + 48} bytes, different each time) with the private key, and another key can't`);
}
