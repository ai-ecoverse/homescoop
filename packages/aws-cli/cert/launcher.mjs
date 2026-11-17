import { awsResponder } from './lib/fake-aws.mjs';
import { LIB, PKG, keyEnv, ok, sh } from './lib/aws.mjs';

// bin/aws and bin/aws_completer (src/launcher.py):
//  - run python3 -S (the shebang), with lib/aws-cli first on sys.path: a .pth
//    in wasix-python's site-packages is not read, and a shadowing module
//    there loses to the CLI's own copy, also when bin/aws runs under a plain
//    python3 (site-packages are dropped from sys.path then);
//  - default AWS_CA_BUNDLE to SSL_CERT_FILE, the kernel proxy's CA: without
//    it botocore trusts only its own bundle and https fails; a user's
//    AWS_CA_BUNDLE wins;
//  - no pager by default, even on a terminal; AWS_PAGER still picks one.
export default async function (ctx) {
  const { assert, write } = ctx;
  await ctx.serve(awsResponder);

  const sp = (await ok(ctx, `python3 -c 'import site; print(site.getsitepackages()[0])'`)).stdout.trim();
  const pth = `${sp}/zz-aws-cli-cert.pth`;
  const shadow = `${sp}/jmespath`;
  const crt = `${sp}/awscrt`;
  await write(pth, 'import sys; sys.stderr.write("aws-cli-cert: site-packages read\\n")\n');
  await write(`${shadow}/__init__.py`, 'raise ImportError("aws-cli-cert: the site-packages jmespath shadowed the CLI\'s")\n');
  // A module the CLI doesn't ship but imports when it can: with
  // site-packages on the path, botocore would find it (HAS_CRT).
  await write(`${crt}/__init__.py`, 'import sys; sys.stderr.write("aws-cli-cert: site-packages awscrt imported\\n")\n');
  try {
    const probe = await sh(ctx, 'python3 -c "import awscrt, jmespath"');
    assert.match(probe.stderr, /aws-cli-cert: site-packages read/, `the .pth probe does not run: ${probe.stderr}`);
    assert.match(probe.stderr, /site-packages awscrt imported/, `the awscrt probe does not run: ${probe.stderr}`);
    assert.match(probe.stderr, /the site-packages jmespath shadowed/, `the shadow does not shadow: ${probe.stderr}`);
    const q = await ok(ctx, `${keyEnv} aws sts get-caller-identity --query Account --output text`);
    assert.equal(q.stdout, '123456789012\n');
    assert.doesNotMatch(q.stderr, /aws-cli-cert/, `aws read site-packages:\n${q.stderr}`);
    // Run by a plain python3: the .pth has run, but sys.path has no
    // site-packages when awscli is imported.
    const plain = await ok(ctx, `${keyEnv} python3 ${PKG}/bin/aws sts get-caller-identity --query Account --output text`);
    assert.equal(plain.stdout, '123456789012\n');
    assert.doesNotMatch(plain.stderr, /shadowed|awscrt imported/, plain.stderr);
  } finally {
    await sh(ctx, `rm -rf '${pth}' '${shadow}' '${crt}'`);
  }

  // The CA: the kernel's, from SSL_CERT_FILE; botocore's own bundle fails.
  const ca = (await ok(ctx, 'printf %s "$SSL_CERT_FILE"')).stdout;
  assert.ok(ca, 'the kernel sets SSL_CERT_FILE');
  const bare = await sh(ctx, `${keyEnv} env -u SSL_CERT_FILE aws sts get-caller-identity`);
  assert.equal(bare.status, 255, `${bare.stdout}${bare.stderr}`);
  assert.match(bare.stderr, /SSL validation failed .*CERTIFICATE_VERIFY_FAILED/, bare.stderr);
  await ok(ctx, `cp "$SSL_CERT_FILE" /tmp/aws-cli-cert-ca.pem`);
  await ok(ctx, `${keyEnv} env -u SSL_CERT_FILE AWS_CA_BUNDLE=/tmp/aws-cli-cert-ca.pem aws sts get-caller-identity`);
  const theirs = await sh(ctx, `${keyEnv} AWS_CA_BUNDLE=${LIB}/awscli/botocore/cacert.pem aws sts get-caller-identity`);
  assert.equal(theirs.status, 255, `a user's AWS_CA_BUNDLE wins: ${theirs.stdout}${theirs.stderr}`);

  // No pager on a terminal by default; AWS_PAGER still names one.
  const env = Object.fromEntries(keyEnv.split(' ').map((kv) => kv.replace(/'/g, '').split(/=(.*)/s).slice(0, 2)));
  const tty = await ctx.pty(['aws', 'sts', 'get-caller-identity', '--output', 'text'], { cwd: '/home', env, timeoutMs: 60000 });
  assert.equal(tty.status, 0, `aws on a pty: status ${tty.status}\n${tty.out}`);
  assert.match(tty.out, /123456789012\s+arn:aws:iam::123456789012:user\/cert/, tty.out);
  const paged = await ctx.pty(['aws', 'sts', 'get-caller-identity', '--output', 'text'], { cwd: '/home', env: { ...env, AWS_PAGER: 'tee /tmp/aws-cli-cert-paged' }, timeoutMs: 60000 });
  assert.equal(paged.status, 0, `AWS_PAGER=tee: status ${paged.status}\n${paged.out}`);
  assert.match((await ok(ctx, 'cat /tmp/aws-cli-cert-paged')).stdout, /123456789012/, 'the pager got the output');

  // Invoked under another name, the launcher refuses.
  await ok(ctx, `cp '${PKG}/bin/aws' /tmp/aws2`);
  const other = await sh(ctx, 'python3 /tmp/aws2 --version');
  assert.equal(other.status, 1, other.stdout + other.stderr);
  assert.match(other.stderr, /runs only as aws or aws_completer/, other.stderr);
  console.log(`launcher: python3 -S with lib/aws-cli first (a .pth, a shadowing jmespath and a fake awscrt in ${sp} ignored, also under a plain python3); AWS_CA_BUNDLE defaults to ${ca} (without it: CERTIFICATE_VERIFY_FAILED), a user's wins; no pager on a pty, AWS_PAGER still used`);
}
