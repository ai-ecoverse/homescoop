import { awsResponder } from './lib/fake-aws.mjs';
import { KEYS, clearLog, header, keyEnv, ok, requests, sh } from './lib/aws.mjs';
import { verifySigV4 } from './lib/sigv4.mjs';

// An STS call through the kernel's network: https through the realm proxy,
// TLS terminated with the kernel CA (the launcher hands SSL_CERT_FILE to
// botocore as AWS_CA_BUNDLE), SigV4 signed with access keys from the
// environment and from ~/.aws/credentials (aws configure set). The fake
// server checks nothing; the spec checks the request it logged, the
// signature too, in Node. --output yaml and table work (ruamel.yaml without
// its C extension). Service errors come back as the CLI prints them.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(awsResponder);
  await clearLog(ctx);

  const r = await ok(ctx, `${keyEnv} aws sts get-caller-identity`);
  assert.deepEqual(JSON.parse(r.stdout), { UserId: KEYS.AWS_ACCESS_KEY_ID, Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/cert' });
  const [req, ...more] = await requests(ctx);
  assert.equal(more.length, 0, 'one request');
  assert.equal(req.url, 'https://sts.us-east-1.amazonaws.com/');
  assert.equal(req.method, 'POST');
  assert.equal(Buffer.from(req.body, 'base64').toString(), 'Action=GetCallerIdentity&Version=2011-06-15');
  const sig = verifySigV4(req, KEYS.AWS_SECRET_ACCESS_KEY);
  assert.ok(sig.ok, sig.why);
  assert.deepEqual([sig.key, sig.region, sig.service], [KEYS.AWS_ACCESS_KEY_ID, 'us-east-1', 'sts']);
  const ua = header(req, 'user-agent');
  assert.match(ua, /^aws-cli\/2\.\d+\.\d+ .*lang\/python#3\.15\.\d+ /, ua);
  assert.doesNotMatch(ua, /md\/awscrt/, `no awscrt in the user agent: ${ua}`);

  // --query and --output text; another region.
  assert.equal((await ok(ctx, `${keyEnv} aws sts get-caller-identity --query Account --output text`)).stdout, '123456789012\n');
  const yaml = await ok(ctx, `${keyEnv} aws sts get-caller-identity --output yaml`);
  assert.equal(yaml.stdout, `Account: '123456789012'\nArn: arn:aws:iam::123456789012:user/cert\nUserId: ${KEYS.AWS_ACCESS_KEY_ID}\n`, 'yaml (ruamel.yaml, pure Python)');
  const table = await ok(ctx, `${keyEnv} aws sts get-caller-identity --output table`);
  assert.match(table.stdout, /^\|\s+GetCallerIdentity\s+\|$/m, table.stdout);
  await clearLog(ctx);
  await ok(ctx, `${keyEnv} aws sts get-caller-identity --region eu-west-1`);
  assert.equal((await requests(ctx))[0].url, 'https://sts.eu-west-1.amazonaws.com/');

  // Keys from the shared credentials file, as aws configure set writes them.
  await ok(ctx, `aws configure set aws_access_key_id '${KEYS.AWS_ACCESS_KEY_ID}' && aws configure set aws_secret_access_key '${KEYS.AWS_SECRET_ACCESS_KEY}' && aws configure set region us-east-1`);
  const creds = await ok(ctx, 'cat ~/.aws/credentials');
  assert.match(creds.stdout, new RegExp(`^aws_access_key_id = ${KEYS.AWS_ACCESS_KEY_ID}$`, 'm'));
  await clearLog(ctx);
  const file = await ok(ctx, 'aws sts get-caller-identity --output text --query Arn');
  assert.equal(file.stdout, 'arn:aws:iam::123456789012:user/cert\n');
  assert.ok(verifySigV4((await requests(ctx))[0], KEYS.AWS_SECRET_ACCESS_KEY).ok, 'signed with the credentials file keys');
  await ok(ctx, 'rm -rf ~/.aws');

  // A service error: rc 254 and the CLI's message.
  const denied = await sh(ctx, 'AWS_ACCESS_KEY_ID=AKIADENIEDEXAMPLE0000 AWS_SECRET_ACCESS_KEY=x AWS_DEFAULT_REGION=us-east-1 aws sts get-caller-identity');
  assert.equal(denied.status, 254, `${denied.stdout}${denied.stderr}`);
  assert.match(denied.stderr, /An error occurred \(AccessDenied\) when calling the GetCallerIdentity operation: User is not authorized/, denied.stderr);

  // No credentials at all.
  const none = await sh(ctx, 'env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true aws sts get-caller-identity');
  assert.equal(none.status, 253, `${none.stdout}${none.stderr}`);
  assert.match(none.stderr, /Unable to locate credentials/, none.stderr);
  console.log(`aws sts get-caller-identity over https through the kernel proxy: SigV4 ${sig.signed} verified, keys from the environment and ~/.aws/credentials, --region, --query/--output text, yaml and table; AccessDenied rc 254, no credentials rc 253; user agent ${ua.split(' ').slice(0, 3).join(' ')}…`);
}
