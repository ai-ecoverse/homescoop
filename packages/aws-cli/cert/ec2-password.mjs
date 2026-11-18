import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { awsResponder } from './lib/fake-aws.mjs';
import { clearLog, fixture, keyEnv, ok, requests, setState, sh } from './lib/aws.mjs';

// aws ec2 get-password-data --priv-launch-key decrypts the Windows password
// with the launch key: RSA PKCS#1 v1.5, awscrt.crypto.RSA.decrypt on
// cryptography (src/awscrt). The known answer is the AWS CLI's own
// functional test (tests/functional/ec2/test_get_password_data.py): its
// PasswordData blob and testcli.pem decrypt to "=mG8.r$o-s". A PKCS#8 copy
// of the key decrypts it too; another key, or a key that isn't a PEM, is the
// CLI's "Unable to decrypt password data" (rc 255), and without
// --priv-launch-key the blob is printed as it came.

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);
  const data = JSON.parse(readFileSync(fixture('ec2/password-data.json'), 'utf8'));
  const pem = readFileSync(fixture('ec2/testcli.pem'), 'utf8');
  await write('/tmp/ec2-launch.pem', pem);
  // The same key as PKCS#8 (converted by Node), another key, and no key.
  await write('/tmp/ec2-launch-pkcs8.pem', createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem' }));
  await write('/tmp/ec2-other.pem', generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }));
  await write('/tmp/ec2-not-a-key.pem', 'not a key\n');
  await setState(ctx, { passwordData: data.passwordData });

  const cmd = (key) => `${keyEnv} aws ec2 get-password-data --instance-id i-12345678 --output json${key ? ` --priv-launch-key ${key}` : ''}`;
  for (const key of ['/tmp/ec2-launch.pem', '/tmp/ec2-launch-pkcs8.pem']) {
    await clearLog(ctx);
    const r = await ok(ctx, cmd(key));
    const out = JSON.parse(r.stdout);
    assert.equal(out.PasswordData, data.password, `${key}: ${r.stdout}`);
    assert.equal(out.InstanceId, 'i-12345678');
    const [q] = await requests(ctx);
    assert.equal(new URLSearchParams(Buffer.from(q.decoded, 'base64').toString()).get('Action'), 'GetPasswordData');
  }
  const plain = JSON.parse((await ok(ctx, cmd(''))).stdout);
  assert.equal(plain.PasswordData, data.passwordData, 'without --priv-launch-key the blob is printed');
  for (const key of ['/tmp/ec2-other.pem', '/tmp/ec2-not-a-key.pem']) {
    const r = await sh(ctx, cmd(key));
    assert.equal(r.status, 255, `${key}: rc=${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Unable to decrypt password data using provided private key file\./, r.stderr);
    assert.doesNotMatch(r.stderr, /Traceback|awscrt/, r.stderr);
    assert.doesNotMatch(r.stderr, /Missing Dependency/, r.stderr);
  }
  console.log(`get-password-data --priv-launch-key: the AWS CLI's test blob decrypts to ${JSON.stringify(data.password)} with testcli.pem (PKCS#1 and PKCS#8); another key or no key is "Unable to decrypt password data" (rc 255)`);
}
