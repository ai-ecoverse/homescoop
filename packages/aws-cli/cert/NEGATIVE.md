# aws-cli: negative proof

**Date:** 2026-11-17 (2.40.4-1); 2026-11-18 for the rows marked 2.40.4-2. slicc-kernel 1.189.2 and 1.191.2 (the cert kernels), wasix-python 3.15.0-8 and 3.15.0-10, py-cryptography 50.0.2-1 with py-cffi 2.1.1-2 (2.40.4-2), wasm-tls-engine 4.2.0-12, Chromium through `scripts/browser-cert/run.mjs`, users enforce.

This is a new package, so a person does the first certification. It isn't in `scripts/ci-certified.json`.

`prove-negative.mjs` can't prove anything here. The package has no WebAssembly of its own: `bin/aws` and `bin/aws_completer` are Python scripts, and wasix-python provides the interpreter. So each negative below is the tarball with one part of the packaging undone, run through the same specs. The patches are undone with `patch -R` on `lib/aws-cli` (or the one hunk named), and the launcher edits are made in both `bin/` copies.

## Without awscrt-optional.patch

The negative: the AWS CLI's own `awscli/` from the source distribution, which imports awscrt at module level (`botocore/utils.py`, `credentials.py`, `httpchecksum.py`, `logger.py`, `s3transfer/checksums.py`, `customizations/s3/factory.py`).

```
browser-cert: FAIL packages/aws-cli/cert/checksums.mjs
  File "/node_modules/@ai-ecoverse/aws-cli/lib/aws-cli/awscli/botocore/httpchecksum.py", line 28, in <module>
ModuleNotFoundError: No module named 'awscrt'. Site initialization is disabled, did you forget to add the site-packages directory to sys.path or to enable your virtual environment?
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
browser-cert: ok packages/aws-cli/cert/notices.mjs
browser-cert: FAIL packages/aws-cli/cert/s3.mjs
browser-cert: FAIL packages/aws-cli/cert/sso.mjs
browser-cert: FAIL packages/aws-cli/cert/sts.mjs
browser-cert: FAIL packages/aws-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: aws --version: rc=1
ModuleNotFoundError: No module named 'awscrt'. …
cert-run: FAIL aws-cli fail
```

Every spec that runs `aws` fails. It fails on `aws --version`, before any command runs, so the patch is what makes the CLI import. `notices.mjs` reads files only, so it passes on this tarball, as it should. The same failure shows on the build machine with the unpatched tree and no awscrt installed:

```
  File ".../awscli/botocore/utils.py", line 43, in <module>
    from awscrt.crypto import EC
ModuleNotFoundError: No module named 'awscrt'
```

In 2.40.4-2, with homescoop's crypto-only awscrt in the tree, the unpatched CLI still fails before any command runs, on the first awscrt module that isn't crypto:

```
browser-cert: ok packages/aws-cli/cert/notices.mjs
browser-cert: FAIL packages/aws-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: aws --version: rc=1
  File "/node_modules/@ai-ecoverse/aws-cli/lib/aws-cli/awscli/botocore/httpchecksum.py", line 28, in <module>
    from awscrt import checksums as crt_checksums
ImportError: cannot import name 'checksums' from 'awscrt' (/node_modules/@ai-ecoverse/aws-cli/lib/aws-cli/awscrt/__init__.py)
```

## Without lib/aws-cli/awscrt (2.40.4-2)

The tree without homescoop's awscrt (src/awscrt, awscrt.crypto on cryptography). The CLI's own code imports `awscrt.crypto` at module level again in 2.40.4-2 (`botocore/utils.py`, `credentials.py`, the CloudFront, CloudTrail, EC2, EC2 Instance Connect and login commands), so nothing imports:

```
browser-cert: FAIL packages/aws-cli/cert/cloudfront.mjs
browser-cert: FAIL packages/aws-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: aws --version: rc=1
  File "/node_modules/@ai-ecoverse/aws-cli/lib/aws-cli/awscli/botocore/utils.py", line 43, in <module>
    from awscrt.crypto import EC
ModuleNotFoundError: No module named 'awscrt'. Site initialization is disabled, …
```

## The launcher without its py-* dependencies (2.40.4-2)

`setup()` without the line that adds py-cryptography's and py-cffi's site-packages: the CLI runs, and everything that needs cryptography says so, rc 255, no traceback:

```
browser-cert: FAIL packages/aws-cli/cert/cloudfront.mjs
browser-cert: FAIL packages/aws-cli/cert/cloudtrail.mjs
browser-cert: FAIL packages/aws-cli/cert/ec2-password.mjs
browser-cert: FAIL packages/aws-cli/cert/eic.mjs
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
browser-cert: FAIL packages/aws-cli/cert/login.mjs
browser-cert: FAIL packages/aws-cli/cert/sigv4a.mjs
AssertionError [ERR_ASSERTION]: sign canned-policy-url-basic: rc=255
aws: [ERROR]: Missing Dependency: This command needs cryptography (@ai-ecoverse/py-cryptography, which this AWS CLI build installs beside it), and it could not be imported: No module named 'cryptography'
```

The same message for `cloudtrail verify-query-results`, `ec2-instance-connect ssh`, `aws login` and `ec2 get-password-data --priv-launch-key` (the patch's `decryptpassword.py` hunk lets it through the command's catch-all, which would say "Unable to decrypt password data" instead), and, for an S3 multi-region access point, `Missing Dependency: SigV4a signing needs cryptography (…)`.

## The launcher taking any version of its py-* dependencies (2.40.4-2)

`py_dependencies()` without its `m.get("version") != pin` check. `launcher.mjs` puts a copy of py-cffi that says 2.1.1-1 in `aws-cli/node_modules`, where Node's lookup finds it first, and expects it refused:

```
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: with py-cffi 2.1.1-1 found first: rc=0
https://d111111abcdef8.cloudfront.net/x?Expires=1893456000&Signature=…
```

## The launcher with every discovered py-* package (2.40.4-2)

`setup()` calling wasix-python's own discovery (`_slicc_site.discover()`) instead of `py_dependencies()`: every py-* package installed beside the CLI goes on its path, py-pycparser and the spec's probe package among them:

```
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: /node_modules/@ai-ecoverse/aws-cli/lib/aws-cli
…
/node_modules/@ai-ecoverse/py-cffi/lib/python3.15/site-packages
/node_modules/@ai-ecoverse/py-cryptography/lib/python3.15/site-packages
/node_modules/@ai-ecoverse/py-pycparser/lib/python3/site-packages
```

## Without the SigV4a hunk of awscrt-optional.patch (2.40.4-2)

`botocore/auth.py` without `AUTH_TYPE_MAPS.update(botocore.sigv4a.SIGV4A_AUTH_TYPE_MAPS)`. The suite part of `sigv4a.mjs` signs with `botocore.sigv4a` directly and passes; the multi-region access point does not:

```
browser-cert: FAIL packages/aws-cli/cert/sigv4a.mjs
AssertionError [ERR_ASSERTION]: … aws s3api get-object --bucket arn:aws:s3::123456789012:accesspoint/mfzwi23gnjvgw.mrap --key k.txt /tmp/mrap-out.txt: rc=255
aws: [ERROR]: Unknown Signature Version: v4a.
```

## Without login-remote.patch (2.40.4-2)

`aws login` starts the same-device flow: an authorize URL whose redirect is a callback server on the sandbox's loopback, and then it waits. The spec's driver stops it after 90 s:

```
browser-cert: FAIL packages/aws-cli/cert/login.mjs
AssertionError [ERR_ASSERTION]: aws login: rc=247
Attempting to open your default browser. If the browser does not open, open the following URL.
If you are unable to open the URL on this device, run this command again with the '--remote' option.

https://us-east-1.signin.aws.amazon.com/v1/authorize?response_type=code&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device&state=…&redirect_uri=http%3A%2F%2F127.0.0.1%3A32770%2Foauth%2Fcallback&code_challenge=…
```

## Without help-text.patch

```
browser-cert: FAIL packages/aws-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: aws help: rc=255
aws: [ERROR]: Could not find executable named "groff or mandoc"
```

## Without sso-device-code.patch

`aws sso login --profile cert` on a profile with an `sso-session` starts the Authorization Code flow. It prints an authorize URL whose redirect is a callback server on the sandbox's loopback, then waits up to ten minutes for that redirect:

```
https://oidc.us-east-1.amazonaws.com/authorize?response_type=code&client_id=cert-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A32769%2Foauth%2Fcallback&state=…&code_challenge_method=S256&scopes=sso%3Aaccount%3Aaccess&code_challenge=…
browser-cert: FAIL packages/aws-cli/cert/sso.mjs
AssertionError [ERR_ASSERTION]: aws sso login : status null (null: still running after 90 s)
```

With the patch the device code flow is the default, and `sso.mjs` checks that its output names no `127.0.0.1`, `localhost` or `oauth/callback`.

## The launcher without the AWS_CA_BUNDLE default

```
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
browser-cert: FAIL packages/aws-cli/cert/sts.mjs
aws: [ERROR]: SSL validation failed for https://sts.us-east-1.amazonaws.com/ [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain (_ssl.c:1144)
```

botocore trusts only its own `cacert.pem`, and the kernel's proxy terminates TLS with the kernel CA. `launcher.mjs` also runs the shipped launcher with `SSL_CERT_FILE` unset and expects that same failure. So the spec shows both halves.

## The launcher without -S (a plain `#!/usr/bin/env python3`, site-packages kept)

```
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
stderr=aws-cli-cert: site-packages read
aws-cli-cert: site-packages awscrt imported
    import awscrt.auth
ModuleNotFoundError: No module named 'awscrt.auth'
```

The spec's `.pth` runs. The fake `awscrt` it plants in wasix-python's site-packages makes `HAS_CRT` true, and botocore then imports `awscrt.auth`. That is what a real awscrt for another platform in site-packages would do. With the shipped launcher, neither happens.

## The launcher without the pager default

```
browser-cert: FAIL packages/aws-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: aws on a pty: status 253
aws: [ERROR]: An error occurred (Pager): Unable to redirect output to pager. Received the following error when opening pager:
[Errno 44] No such file or directory: 'less'
```

On a terminal, upstream pipes output to `less`, and slicc has none unless you install it.

## The specs check themselves

- `launcher.mjs` first shows that its probes fire in a plain `python3` (the `.pth`, the fake `awscrt`, the `jmespath` that raises). It then shows that `aws` and `python3 bin/aws` don't read them.
- `sts.mjs` and `s3.mjs` don't trust the CLI's output alone. They check the requests the fake server logged: SigV4 signatures recomputed in Node, and every checksum compared with Node's own CRC (`cert/lib/crc.mjs`, which reproduces the published check values). The tampered objects show that validation is on: the downloads fail with `did not match`.
- `checksums.mjs` compares `botocore/crc.py` with Node on random data. A wrong table or combine step fails there, and in `test/crc.test.mjs` on the host.
- The crypto specs check results against references from elsewhere, not against the code under test, and two broken builds show it (2.40.4-2). `awscrt/crypto.py` signing SHA-1 digests as messages (`hashes.SHA1()` instead of `Prehashed(hashes.SHA1())`, a hashed-twice signature of the right length) fails `cloudfront.mjs` on the first case: `canned-policy-url-basic: the signature does not verify`, against Node and AWS's expected signature. `botocore/sigv4a.py` taking k0 for the private key instead of k0 + 1 fails `sigv4a.mjs` on the first test: `get-header-key-duplicate: the derived key`, X d042083d… where aws-c-auth's suite has b6618f6a….
- The known answers are AWS's: aws-c-auth's SigV4a suite (what awscrt's signer is tested with), and the AWS CLI's own functional test data (the cross-SDK CloudFront cases, the Windows password blob and key, a CloudTrail Lake export signed by CloudTrail). Node checks what is randomized (ECDSA signatures, DPoP proofs, generated keys) by verifying it, and derives the SigV4a key on its own (`cert/lib/sigv4.mjs`).
