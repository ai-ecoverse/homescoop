import { awsResponder } from './lib/fake-aws.mjs';
import { clearLog, header, ok, requests } from './lib/aws.mjs';
import { verifySigV4 } from './lib/sigv4.mjs';

// IAM Identity Center sign-in with the device code flow, against the fake in
// cert/lib/fake-aws.mjs: aws sso login registers a client, starts a device
// authorization, prints the verification URL and the code, polls CreateToken
// (pending once) and caches the token; the profile's calls then get role
// credentials from the SSO portal with it and are signed with those.
// sso-device-code.patch makes the device code flow the default, since the
// Authorization Code flow's callback server on 127.0.0.1 is out of a
// browser's reach in slicc; --use-device-code still works.
const CONFIG = `[profile cert]
sso_session = cert
sso_account_id = 123456789012
sso_role_name = ReadOnly
region = us-east-1

[sso-session cert]
sso_start_url = https://cert.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access
`;

export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);
  await ok(ctx, 'mkdir -p ~/.aws');
  await write('/root/.aws/config', CONFIG);

  for (const flags of ['', '--use-device-code', '--no-browser']) {
    await ok(ctx, 'rm -rf ~/.aws/sso');
    await clearLog(ctx);
    // On a terminal, with a time limit: the Authorization Code flow would
    // wait ten minutes for a callback on 127.0.0.1 (NEGATIVE.md).
    const argv = ['aws', 'sso', 'login', '--profile', 'cert', ...flags.split(' ').filter(Boolean)];
    const r = await ctx.pty(argv, { cwd: '/root', timeoutMs: 90000 });
    const out = r.out.replace(/\r/g, '');
    assert.equal(r.status, 0, `aws sso login ${flags}: status ${r.status} (null: still running after 90 s)\n${out}`);
    assert.match(out, /https:\/\/device\.sso\.us-east-1\.amazonaws\.com\//, out);
    assert.match(out, /CERT-CODE/, out);
    assert.match(out, /Successfully logged into Start URL: https:\/\/cert\.awsapps\.com\/start/, out);
    assert.doesNotMatch(out, /127\.0\.0\.1|localhost|oauth\/callback/, out);
    const log = await requests(ctx);
    const paths = log.map((q) => `${q.method} ${new URL(q.url).host}${new URL(q.url).pathname}`);
    assert.deepEqual(paths.filter((p) => p.includes('oidc.')), [
      'POST oidc.us-east-1.amazonaws.com/client/register',
      'POST oidc.us-east-1.amazonaws.com/device_authorization',
      'POST oidc.us-east-1.amazonaws.com/token',
      'POST oidc.us-east-1.amazonaws.com/token',
    ], paths.join('\n'));
    const start = JSON.parse(Buffer.from(log.find((x) => x.url.endsWith('/device_authorization')).body, 'base64').toString());
    assert.equal(start.startUrl, 'https://cert.awsapps.com/start');
    const cache = await ok(ctx, 'cat ~/.aws/sso/cache/*.json');
    assert.match(cache.stdout, /"accessToken": "cert-sso-access-token"/, cache.stdout);
  }

  await clearLog(ctx);
  const who = await ok(ctx, 'aws sts get-caller-identity --profile cert');
  assert.deepEqual(JSON.parse(who.stdout), { UserId: 'ASIACERTEXAMPLE00000', Account: '123456789012', Arn: 'arn:aws:sts::123456789012:assumed-role/ReadOnly/cert' });
  const log = await requests(ctx);
  const creds = log.find((q) => q.url.startsWith('https://portal.sso.us-east-1.amazonaws.com/federation/credentials'));
  assert.ok(creds, log.map((q) => q.url).join('\n'));
  assert.equal(header(creds, 'x-amz-sso_bearer_token'), 'cert-sso-access-token');
  const q = new URL(creds.url).searchParams;
  assert.deepEqual([q.get('account_id'), q.get('role_name')], ['123456789012', 'ReadOnly']);
  const sts = log.find((x) => x.url.startsWith('https://sts.'));
  assert.equal(header(sts, 'x-amz-security-token'), 'cert-sso-session');
  assert.ok(verifySigV4(sts, 'cert-sso-secret').ok, 'signed with the role credentials');
  await ok(ctx, 'rm -rf ~/.aws');
  console.log('aws sso login (default, --use-device-code, --no-browser): device code flow, verification URL and code printed, CreateToken polled past authorization_pending, token cached, no loopback; the profile gets role credentials from the SSO portal and signs STS with them');
}
