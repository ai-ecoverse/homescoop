import { LIB, PKG, ok, sh } from './lib/aws.mjs';

// aws --version names the recipe's release and wasix-python's CPython 3.15.
// The tree has no awscrt, and botocore.compat.HAS_CRT says so
// (awscrt-optional.patch; NEGATIVE.md: without the patch, every command
// fails with "No module named 'awscrt'"). aws help renders plain text, as
// there is no groff or mandoc here (help-text.patch), and aws_completer
// completes from the autocomplete index build.sh generated.
export default async function (ctx) {
  const { assert } = ctx;
  const pkg = JSON.parse((await ok(ctx, `cat '${PKG}/package.json'`)).stdout);
  const release = pkg.homescoop.upstream;
  const v = await ok(ctx, 'aws --version');
  assert.match(v.stdout, new RegExp(`^aws-cli/${release.replace(/\./g, '\\.')} Python/3\\.15\\.\\d+ \\S+ source/\\S+\\n$`), v.stdout);
  assert.equal(v.stderr, '', v.stderr);

  const crt = await ok(ctx, `python3 -S -c 'import importlib.util, sys; sys.path.insert(0, "${LIB}"); import awscli, botocore.compat as c; print(importlib.util.find_spec("awscrt"), c.HAS_CRT)'`);
  assert.equal(crt.stdout, 'None False\n', `awscrt in the tree, or HAS_CRT: ${crt.stdout}${crt.stderr}`);

  const help = await ok(ctx, 'aws help');
  assert.match(help.stdout, /^Description\n\*{11}\n/m, help.stdout.slice(0, 500));
  assert.match(help.stdout, /aws \[options\] <command> <subcommand> \[parameters\]/);
  assert.doesNotMatch(help.stdout + help.stderr, /Could not find executable|groff/);
  const cpHelp = await ok(ctx, 'aws s3 cp help');
  assert.match(cpHelp.stdout, /^cp\n\^\^\n/m, cpHelp.stdout.slice(0, 300));
  assert.match(cpHelp.stdout, /^"--checksum-algorithm" \(string\)/m);
  assert.match(cpHelp.stdout, /^Examples\n\*{8}\n/m, 'aws s3 cp help has its examples (awscli/examples)');

  for (const [line, want] of [['aws s3 c', /^cp$/m], ['aws sts get-caller-i', /^get-caller-identity$/m], ['aws ec2 describe-instances --instance-i', /^--instance-ids$/m]]) {
    const c = await sh(ctx, `COMP_LINE='${line}' COMP_POINT=${line.length} aws_completer`);
    assert.equal(c.status, 0, `aws_completer '${line}': ${c.stderr}`);
    assert.match(c.stdout, want, `aws_completer '${line}': ${c.stdout}`);
  }
  console.log(`aws --version: ${v.stdout.trim()}; no awscrt (HAS_CRT False); aws help and aws s3 cp help as text; aws_completer completes from ac.index`);
}
