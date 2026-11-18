import { awsResponder } from './lib/fake-aws.mjs';
import { keyEnv, ok, requests, clearLog, sh } from './lib/aws.mjs';

// What still needs awscrt says so, with rc 255 and no traceback, and sends no
// request (awscrt-optional.patch): EC2 Instance Connect's tunnel, a
// websocket through awscrt's HTTP stack (open-tunnel, and ssh
// --connection-type eice, which runs it as ssh's ProxyCommand). The xxhash
// checksums are in s3.mjs. preferred_transfer_client = crt warns and uses the
// classic S3 client. The commands' help renders, as their modules import
// without awscrt, and so does the help of the ones awscrt.crypto on
// cryptography brings back (cloudfront.mjs, cloudtrail.mjs, ec2-password.mjs,
// eic.mjs, login.mjs, sigv4a.mjs).
const MISSING = /^\naws: \[ERROR\]: Missing Dependency: .* requires awscrt, the AWS Common Runtime, which this AWS CLI build does not include\.\n/;

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);
  await clearLog(ctx);
  const tunnel = await sh(ctx, `${keyEnv} aws ec2-instance-connect open-tunnel --instance-id i-0123456789abcdef0 --private-ip-address 10.0.0.10 --instance-connect-endpoint-id eice-0123456789abcdef0 --instance-connect-endpoint-dns-name eice-0123456789abcdef0.12345678.ec2-instance-connect-endpoint.us-east-1.amazonaws.com --local-port 2222 </dev/null`);
  assert.equal(tunnel.status, 255, `open-tunnel: rc=${tunnel.status}\n${tunnel.stdout}${tunnel.stderr}`);
  assert.match(tunnel.stderr, MISSING, tunnel.stderr);
  assert.match(tunnel.stderr, /EC2 Instance Connect's websocket tunnel/, tunnel.stderr);
  assert.doesNotMatch(tunnel.stderr, /Traceback/, tunnel.stderr);
  assert.deepEqual((await requests(ctx)).map((q) => q.url), [], 'open-tunnel sent requests');

  await write('/tmp/crt-small.txt', 'small\n');
  await ok(ctx, 'aws configure set default.s3.preferred_transfer_client crt');
  try {
    const cp = await ok(ctx, `${keyEnv} aws s3 cp /tmp/crt-small.txt s3://cert-bucket/crt-small.txt`);
    assert.match(cp.stderr, /preferred_transfer_client = crt needs awscrt, which this AWS CLI build does not include; using the classic transfer client/, cp.stderr);
  } finally {
    await ok(ctx, 'aws configure set default.s3.preferred_transfer_client auto');
  }

  for (const cmd of ['login help', 'cloudfront sign help', 'cloudtrail validate-logs help', 'ec2-instance-connect open-tunnel help', 'ec2-instance-connect ssh help', 'ec2 get-password-data help']) {
    const h = await ok(ctx, `aws ${cmd}`);
    assert.match(h.stdout, /^Description\n\*{11}\n/m, `aws ${cmd}`);
  }
  console.log('needs awscrt, says so (rc 255, no request): ec2-instance-connect open-tunnel; preferred_transfer_client = crt warns and uses the classic client; the help of the crypto commands renders');
}
