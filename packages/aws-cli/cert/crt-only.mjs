import { awsResponder } from './lib/fake-aws.mjs';
import { keyEnv, ok, requests, clearLog, sh } from './lib/aws.mjs';

// What needs awscrt says so, with rc 255 and no traceback, and sends no
// request (awscrt-optional.patch): SigV4a (an S3 multi-region access point),
// `aws login`, `aws cloudfront sign`, CloudTrail's validate-logs and
// get-password-data --priv-launch-key. The commands' help still renders,
// since the modules import without awscrt.
const MISSING = /^\naws: \[ERROR\]: Missing Dependency: .* requires awscrt, the AWS Common Runtime, which this AWS CLI build does not include\.\n/;

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);
  await write('/tmp/crt-key.pem', '-----BEGIN RSA PRIVATE KEY-----\nMA==\n-----END RSA PRIVATE KEY-----\n');
  const cases = [
    ['SigV4a (MRAP)', 's3api get-object --bucket arn:aws:s3::123456789012:accesspoint/mfzwi23gnjvgw.mrap --key k /tmp/crt-out', /SigV4a signing/],
    ['aws login', 'login', /`aws login`/],
    ['cloudfront sign', 'cloudfront sign --url https://d111111abcdef8.cloudfront.net/x --key-pair-id K2JCJMDEHXQW5F --private-key file:///tmp/crt-key.pem --date-less-than 2030-01-01', /Signing CloudFront URLs and cookies/],
    ['cloudtrail validate-logs', 'cloudtrail validate-logs --trail-arn arn:aws:cloudtrail:us-east-1:123456789012:trail/cert --start-time 2026-01-01', /Validating CloudTrail digest signatures/],
  ];
  for (const [what, args, name] of cases) {
    await clearLog(ctx);
    const r = await sh(ctx, `${keyEnv} aws ${args} </dev/null`);
    assert.equal(r.status, 255, `${what}: rc=${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, MISSING, `${what}: ${r.stderr}`);
    assert.match(r.stderr, name, `${what}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Traceback/, r.stderr);
    assert.deepEqual((await requests(ctx)).map((q) => q.url), [], `${what} sent requests`);
  }
  for (const cmd of ['login help', 'cloudfront sign help', 'cloudtrail validate-logs help', 'ec2-instance-connect open-tunnel help', 'ec2 get-password-data help']) {
    const h = await ok(ctx, `aws ${cmd}`);
    assert.match(h.stdout, /^Description\n\*{11}\n/m, `aws ${cmd}`);
  }
  console.log('needs awscrt, says so (rc 255, no request): SigV4a for an MRAP, aws login, cloudfront sign, cloudtrail validate-logs; their help renders');
}
