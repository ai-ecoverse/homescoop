// Writes the cert's known-answer fixtures. By hand, not in CI:
//   node packages/aws-cli/cert/fixtures/fetch.mjs
//
// - sigv4a-suite.json: the SigV4a test suite of awslabs/aws-c-auth
//   (tests/aws-signing-test-suite/v4a, Apache-2.0) at a pinned commit, the
//   vectors awscrt's own SigV4a signer is tested with.
// - cloudfront/, ec2/, cloudtrail/: the AWS CLI's own functional test data
//   (Apache-2.0), from the recipe's source distribution (its sha256 checked):
//   CloudFront's cross-SDK signing cases and keys
//   (tests/functional/cloudfront/testdata), the Windows password blob and key
//   of tests/functional/ec2/test_get_password_data.py, and a CloudTrail Lake
//   query export with its sign file and signing key
//   (tests/functional/cloudtrail/test_resource, test_verifyqueryresults.py).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'aws-cli-fixtures-'));

async function download(url, file, sha256) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (sha256 && got !== sha256) throw new Error(`${url}: sha256 ${got}, the recipe pins ${sha256}`);
  writeFileSync(file, bytes);
}

async function sigv4aSuite() {
  const REPO = 'awslabs/aws-c-auth';
  const COMMIT = 'cf69fb7edf7c973524348bbcecda1b1684de4d5e';
  const DIR = 'tests/aws-signing-test-suite/v4a';
  const FILES = {
    context: 'context.json',
    request: 'request.txt',
    publicKey: 'public-key.json',
    headerCanonicalRequest: 'header-canonical-request.txt',
    headerStringToSign: 'header-string-to-sign.txt',
    headerSignature: 'header-signature.txt',
    headerSignedRequest: 'header-signed-request.txt',
    queryCanonicalRequest: 'query-canonical-request.txt',
    queryStringToSign: 'query-string-to-sign.txt',
    querySignature: 'query-signature.txt',
    querySignedRequest: 'query-signed-request.txt',
  };
  const tgz = join(tmp, 'aws-c-auth.tgz');
  await download(`https://codeload.github.com/${REPO}/tar.gz/${COMMIT}`, tgz);
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const suite = join(tmp, `aws-c-auth-${COMMIT}`, DIR);
  const tests = {};
  for (const name of readdirSync(suite).sort()) {
    const t = {};
    for (const [k, f] of Object.entries(FILES)) {
      const p = join(suite, name, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      t[k] = f.endsWith('.json') ? JSON.parse(text) : text;
    }
    tests[name] = t;
  }
  const out = { source: `https://github.com/${REPO}/tree/${COMMIT}/${DIR}`, license: 'Apache-2.0', tests };
  writeFileSync(join(here, 'sigv4a-suite.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`sigv4a-suite.json: ${Object.keys(tests).length} tests from ${REPO}@${COMMIT}`);
}

async function awsCliTests() {
  const recipe = JSON.parse(execFileSync('node', [join(root, 'scripts/read-recipe.mjs'), 'aws-cli', '--json'], { encoding: 'utf8' }));
  const url = recipe.source.url.replace('{{version}}', recipe.version);
  const tgz = join(tmp, 'awscli.tgz');
  await download(url, tgz, recipe.source.sha256);
  execFileSync('tar', ['-xzf', tgz, '-C', tmp, `awscli-${recipe.version}/tests/functional`]);
  const tests = join(tmp, `awscli-${recipe.version}`, 'tests', 'functional');
  const source = `${url} (tests/functional)`;
  const constant = (file, name) => {
    const text = readFileSync(join(tests, file), 'utf8');
    const m = new RegExp(`^${name} = \\(\\n((?:\\s+"[^"]*"\\n)+)\\)`, 'm').exec(text);
    if (!m) throw new Error(`${file}: no ${name}`);
    return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('');
  };

  rmSync(join(here, 'cloudfront'), { recursive: true, force: true });
  cpSync(join(tests, 'cloudfront', 'testdata'), join(here, 'cloudfront'), { recursive: true });

  mkdirSync(join(here, 'ec2'), { recursive: true });
  cpSync(join(tests, 'ec2', 'testcli.pem'), join(here, 'ec2', 'testcli.pem'));
  const py = readFileSync(join(tests, 'ec2', 'test_get_password_data.py'), 'utf8');
  // test_priv_launch_key: assertIn('"PasswordData": "<the password>"', output)
  const password = /^\s+self\.assertIn\('"PasswordData": "([^"%]+)"', output\)$/m.exec(py)[1];
  writeFileSync(join(here, 'ec2', 'password-data.json'), `${JSON.stringify({
    source: `${source}/ec2/test_get_password_data.py`,
    key: 'testcli.pem',
    passwordData: constant('ec2/test_get_password_data.py', 'PASSWORD_DATA'),
    password,
  }, null, 1)}\n`);

  rmSync(join(here, 'cloudtrail'), { recursive: true, force: true });
  cpSync(join(tests, 'cloudtrail', 'test_resource'), join(here, 'cloudtrail'), { recursive: true });
  const vqr = readFileSync(join(tests, 'cloudtrail', 'test_verifyqueryresults.py'), 'utf8');
  writeFileSync(join(here, 'cloudtrail', 'lake-public-key.json'), `${JSON.stringify({
    source: `${source}/cloudtrail/test_verifyqueryresults.py`,
    fingerprint: /^SAMPLE_PUBLIC_KEY_FINGERPRINT = "([0-9a-f]+)"/m.exec(vqr)[1],
    value: constant('cloudtrail/test_verifyqueryresults.py', 'SAMPLE_PUBLIC_KEY'),
  }, null, 1)}\n`);
  console.log(`cloudfront/, ec2/, cloudtrail/: from ${url}`);
}

try {
  await sigv4aSuite();
  await awsCliTests();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
