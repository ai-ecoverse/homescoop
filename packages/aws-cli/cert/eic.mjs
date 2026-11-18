import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { awsResponder } from './lib/fake-aws.mjs';
import { clearLog, header, keyEnv, requests, sh } from './lib/aws.mjs';

// aws ec2-instance-connect ssh generates a one-time Ed25519 key
// (awscrt.crypto.ED25519 on cryptography, src/awscrt), pushes its public key
// with SendSSHPublicKey and runs ssh with the private key. Against the fakes
// of EC2 (DescribeInstances: a public IP) and EC2 Instance Connect, with an
// `ssh` on PATH that keeps its arguments and the key file it was given:
// ssh gets -i <key>, the port and ec2-user@<public IP>, and the key file is
// an unencrypted OpenSSH private key (openssh-key-v1, RFC 8709) whose public
// half is the one pushed, and which signs what that public key verifies.
// The command exits with ssh's status. (The tunnel for instances without a
// public IP, --connection-type eice, needs awscrt's websocket: crt-only.mjs.)
const SSH = `#!/usr/bin/env bash
printf '%s\\n' "$@" >/tmp/eic/argv
while [ $# -gt 0 ]; do [ "$1" = -i ] && cat "$2" >/tmp/eic/key; shift; done
echo fake ssh
exit 7
`;

function readString(buf, at) {
  const n = buf.readUInt32BE(at);
  return [buf.subarray(at + 4, at + 4 + n), at + 4 + n];
}

// openssh-key-v1, unencrypted, one Ed25519 key: { pub, seed } (32 bytes each).
function parseOpenSSH(pem, assert) {
  const m = /^-----BEGIN OPENSSH PRIVATE KEY-----\n([A-Za-z0-9+/=\n]+)\n-----END OPENSSH PRIVATE KEY-----\n$/.exec(pem);
  assert.ok(m, `not an OpenSSH private key:\n${pem}`);
  const buf = Buffer.from(m[1].replace(/\n/g, ''), 'base64');
  assert.equal(buf.subarray(0, 15).toString('latin1'), 'openssh-key-v1\0');
  let at = 15;
  const fields = [];
  for (let i = 0; i < 3; i++) {
    let f;
    [f, at] = readString(buf, at);
    fields.push(f.toString());
  }
  assert.deepEqual(fields, ['none', 'none', ''], 'cipher, KDF, KDF options: unencrypted');
  assert.equal(buf.readUInt32BE(at), 1, 'one key');
  let pubBlob, priv;
  [pubBlob, at] = readString(buf, at + 4);
  [priv] = readString(buf, at);
  assert.equal(priv.readUInt32BE(0), priv.readUInt32BE(4), 'the two check numbers');
  let p = 8, type, pub, secret, comment;
  [type, p] = readString(priv, p);
  [pub, p] = readString(priv, p);
  [secret, p] = readString(priv, p);
  [comment, p] = readString(priv, p);
  assert.equal(type.toString(), 'ssh-ed25519');
  assert.equal(pub.length, 32);
  assert.equal(secret.length, 64);
  assert.deepEqual(secret.subarray(32), pub, 'the private key ends with its public key');
  assert.deepEqual([...priv.subarray(p)], [...priv.subarray(p)].map((_, i) => i + 1), 'padding 1, 2, 3, …');
  assert.equal(priv.length % 8, 0, 'the private section is padded to 8 bytes');
  const [blobType, rest] = readString(pubBlob, 0);
  assert.equal(blobType.toString(), 'ssh-ed25519');
  assert.deepEqual(readString(pubBlob, rest)[0], pub, 'the public key blob');
  return { pub, seed: secret.subarray(0, 32), comment: comment.toString(), blob: pubBlob };
}

export default async function (ctx) {
  const { assert, write, read } = ctx;
  await ctx.serve(awsResponder);
  await write('/tmp/eic/bin/ssh', SSH);
  await sh(ctx, 'chmod 755 /tmp/eic/bin/ssh');
  await clearLog(ctx);
  const r = await sh(ctx, `${keyEnv} PATH=/tmp/eic/bin:$PATH aws ec2-instance-connect ssh --instance-id i-0123456789abcdef0 --connection-type direct </dev/null`);
  assert.equal(r.status, 7, `aws ec2-instance-connect ssh: rc=${r.status} (ssh's is 7)\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /fake ssh/);
  assert.doesNotMatch(r.stderr, /Traceback|Missing Dependency/, r.stderr);

  const argv = (await read('/tmp/eic/argv')).trim().split('\n');
  assert.equal(argv.at(-1), 'ec2-user@203.0.113.10', argv.join(' '));
  assert.deepEqual(argv.slice(argv.indexOf('-p'), argv.indexOf('-p') + 2), ['-p', '22']);
  assert.ok(argv.includes('-i'), argv.join(' '));
  const key = parseOpenSSH(await read('/tmp/eic/key'), assert);

  const log = await requests(ctx);
  const push = log.find((q) => /\.SendSSHPublicKey$/.test(header(q, 'x-amz-target') || ''));
  assert.ok(push, log.map((q) => q.url).join('\n'));
  const sent = JSON.parse(Buffer.from(push.decoded, 'base64').toString());
  assert.equal(sent.InstanceId, 'i-0123456789abcdef0');
  assert.equal(sent.InstanceOSUser, 'ec2-user');
  assert.equal(sent.SSHPublicKey, `ssh-ed25519 ${key.blob.toString('base64')}`, 'the pushed key is the key ssh got');

  const priv = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: key.seed.toString('base64url'), x: key.pub.toString('base64url') }, format: 'jwk' });
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.pub.toString('base64url') }, format: 'jwk' });
  const msg = Buffer.from('ec2-instance-connect cert');
  assert.ok(verify(null, msg, pub, sign(null, msg, priv)), 'the key pair signs and verifies');
  const again = await sh(ctx, `${keyEnv} PATH=/tmp/eic/bin:$PATH aws ec2-instance-connect ssh --instance-id i-0123456789abcdef0 --connection-type direct </dev/null`);
  assert.equal(again.status, 7);
  assert.notDeepEqual(parseOpenSSH(await read('/tmp/eic/key'), assert).pub, key.pub, 'a new key each time');
  console.log(`ec2-instance-connect ssh: a new Ed25519 key per run, its public half pushed (SendSSHPublicKey), the private half an OpenSSH key file handed to ssh -i for ec2-user@203.0.113.10; rc is ssh's`);
}
