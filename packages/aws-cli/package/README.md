# `@ai-ecoverse/aws-cli`

The AWS Command Line Interface v2: aws, to manage AWS services from slicc.

This is AWS's own CLI, release 2.40.4, not a reimplementation. It runs on
`@ai-ecoverse/wasix-python`, which it installs. Upstream syntax works as
documented: `aws sts get-caller-identity`, `aws s3 ls`, `aws s3 cp`,
`aws s3 sync`, `aws ec2 describe-instances`, `aws lambda list-functions`,
`--query`, `--output json|text|table|yaml`, `aws help`.

| Command | What runs |
| --- | --- |
| `aws` | `lib/aws-cli/bin/aws`, AWS's launcher, with the CLI in `lib/aws-cli/awscli` |
| `aws_completer` | `lib/aws-cli/bin/aws_completer`, the shell completer (`complete -C aws_completer aws` in bash) |

## Signing in

Access keys, from the environment or from `aws configure`:

```sh
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity

aws configure          # writes ~/.aws/credentials and ~/.aws/config
```

`AWS_SESSION_TOKEN`, named profiles, `credential_process` and
`role_arn`/`source_profile` (assume role) work as upstream documents.

IAM Identity Center (SSO) uses the device code flow:

```sh
aws configure sso      # once: start URL, region, account, role
aws sso login          # prints a URL and a code; open it, enter the code
```

`aws sso login` prints `https://device.sso.<region>.amazonaws.com/` and a
code. Open that page in any browser, sign in and enter the code, and the CLI
picks the token up. The device code flow is the default here, with no flag.
Upstream's default for an `sso-session` profile is the Authorization Code
flow, which redirects the browser to a callback server on `127.0.0.1`, and in
slicc no browser can reach the loopback the CLI listens on.
`--use-device-code` still works, and so does `--no-browser`.

`aws login` (sign in with your AWS Management Console credentials) uses
upstream's `--remote` flow, which is the default here: it prints a URL, you
sign in in any browser, and paste back the code the page shows. The flow
upstream defaults to redirects the browser to a callback server on
`127.0.0.1`, which, as for `aws sso login`, no browser in slicc can reach.
The credentials it caches refresh themselves, as upstream.

## What's different from a normal install

- **No awscrt.** The AWS Common Runtime is a native extension with no WASIX
  build. This build makes it optional again, as it is in standalone
  botocore:
  - The default request checksum is CRC32 (zlib), as in standalone botocore,
    not CRC64NVME.
  - CRC32C and CRC64NVME (`--checksum-algorithm`, and validating downloads
    of objects stored with them) are computed in pure Python, at about
    6 MB/s. To skip validating large downloads, set
    `response_checksum_validation = when_required` in `~/.aws/config`.
  - `aws s3` always uses the classic transfer client. A
    `preferred_transfer_client = crt` setting prints a warning and uses the
    classic one.
- **Its crypto comes from cryptography.** What the CLI did with awscrt's
  RSA, EC and Ed25519 keys runs on
  [`@ai-ecoverse/py-cryptography`](https://www.npmjs.com/package/@ai-ecoverse/py-cryptography),
  which this package installs, as the AWS CLI v2 itself did until
  2024-2025. `lib/aws-cli/awscrt` is not awscrt: it is awscrt's
  `awscrt.crypto` API on cryptography, and nothing else of awscrt. So these
  work as upstream documents them:
  - `aws cloudfront sign` and `sign-cookies` (RSA with SHA-1 or SHA-256,
    ECDSA P-256);
  - `aws ec2 get-password-data --priv-launch-key`;
  - `aws cloudtrail validate-logs` and `verify-query-results`;
  - `aws ec2-instance-connect ssh` to an instance's address: the one-time
    Ed25519 key it generates and pushes, for the `ssh` on PATH it runs;
  - `aws login`, and its credentials, with their DPoP-bound refresh;
  - SigV4a, for S3 multi-region access points and other endpoints that
    need it: botocore's own SigV4 signers with SigV4a's key and scope
    (`botocore/sigv4a.py`), checked against the SigV4a test suite of AWS's
    signing library. `aws s3 presign` on a multi-region access point works
    too.
- **Needs awscrt, so not available:**
  - `aws ec2-instance-connect open-tunnel`, and `ssh --connection-type eice`
    (and `auto` for an instance with only a private address), which tunnel
    through a websocket on awscrt's HTTP stack;
  - the xxhash checksums (`--checksum-algorithm XXHASH64`, `XXHASH3`,
    `XXHASH128`);
  - the CRT S3 transfer client.

  They stop with `Missing Dependency: … requires awscrt`.
- **Help is plain text.** There is no `groff` or `mandoc` here, so
  `aws help` and `aws <command> help` render as text, as the CLI does on
  Windows.
- **No pager by default.** Upstream pipes output on a terminal to `less`. To
  use one, set `AWS_PAGER`, `cli_pager` in `~/.aws/config`, or `PAGER`, for
  example after installing `@ai-ecoverse/wasm-less`.
- **TLS:** `AWS_CA_BUNDLE` defaults to `SSL_CERT_FILE`, the CA of slicc's
  network proxy, because botocore otherwise trusts only its own bundle. Set
  `AWS_CA_BUNDLE` yourself to use another one.
- **Launchers:** `bin/aws` and `bin/aws_completer` are one Python script. It
  runs `python3 -S` with `lib/aws-cli` first on the path, so a `py-*`
  package or a `.pth` file in wasix-python's site-packages can't change
  which code the CLI runs. After the standard library it adds the
  site-packages of the two `py-*` packages this one depends on,
  py-cryptography and py-cffi, found from this package's directory as Node
  finds dependencies, and only at exactly the versions its `package.json`
  pins. If one of them is missing or at another version, the CLI still
  runs, and the commands above say they need cryptography.
- **Not included:** `ruamel.yaml.clib` (optional C speedups; YAML output
  uses ruamel.yaml's pure-Python code) and the AWS installers' frozen
  executables. `aws update` refuses, as it does on any install from source:
  to update, install a newer version of this package.
- A call takes a few seconds to start in the kernel (about 3 s for
  `aws --version`), and loading cryptography adds about 2 s to the
  commands above.

Licensed under Apache-2.0 (`LICENSE` is AWS's notice followed by the
license text). The libraries in `lib/aws-cli` beside the CLI (colorama,
distro, docutils, jmespath, prompt_toolkit, python-dateutil, ruamel.yaml,
six, urllib3, wcwidth) are under their own licenses, kept in their
`.dist-info` directories and in `THIRD-PARTY-NOTICES.md`. cryptography and
cffi are separate packages, with their own licenses.
