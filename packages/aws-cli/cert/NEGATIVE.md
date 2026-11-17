# aws-cli: negative proof

**Date:** 2026-11-17. slicc-kernel 1.189.2 (the cert kernel), wasix-python 3.15.0-8, wasm-tls-engine 4.2.0-12, Chromium through `scripts/browser-cert/run.mjs`, users enforce.

This is a new package, so a person does the first certification. It isn't in `scripts/ci-certified.json`.

`prove-negative.mjs` can't prove anything here. The package has no WebAssembly of its own: `bin/aws` and `bin/aws_completer` are Python scripts, and wasix-python provides the interpreter. So each negative below is the 2.40.4-1 tarball with one part of the packaging undone, run through the same specs. The three patches are undone with `patch -R` on `lib/aws-cli`, and the launcher edits are made in both `bin/` copies.

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
