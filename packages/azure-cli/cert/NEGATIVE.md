# azure-cli: negative proof

**Date:** 2026-11-17. slicc-kernel 1.189.2 (the cert kernel), wasix-python 3.15.0-8, wasm-tls-engine 4.2.0-12, Chromium through `scripts/browser-cert/run.mjs`, users enforce.

This is a new package, so the first certification is by a person. It isn't in `scripts/ci-certified.json`.

`prove-negative.mjs` can't prove anything here. The package has no WebAssembly of its own: `bin/az` is a Python script, and the interpreter is wasix-python's. So each negative below is the 2.93.0-1 tarball (sha256 `74144f09…8dc1`) with one part of the packaging undone, repacked with `npm pack` and run through the spec that covers that part. Each spec fails.

## can-launch-browser-wasi.patch reverted

`lib/azure-cli/azure/cli/core/util.py` back to upstream's `if platform_name != 'linux':`.

```
browser-cert: FAIL packages/azure-cli/cert/login.mjs
AssertionError [ERR_ASSERTION]: az login: rc=124
WARNING: A web browser has been opened at https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize. Please continue the login in the web browser. If no web browser is available or if the web browser fails to open, use device code flow with `az login --use-device-code`.
```

No browser opened. az waits on MSAL's localhost listener until `timeout 180` ends it.

## storage-encryption-without-cryptography.patch reverted

`azure/storage/blob/_encryption.py` back to its module-level `from cryptography…` imports.

```
browser-cert: FAIL packages/azure-cli/cert/storage.mjs
AssertionError [ERR_ASSERTION]: AZURE_CONFIG_DIR=/root/.azure-cert-storage az storage account list: rc=1
stderr=ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: 'NoneType' object is not iterable
```

The storage module's arguments name data-plane models. azure-cli-core's `get_sdk()` swallows the ImportError and returns None, so every `az storage` command fails, even the ARM one.

## The launcher without its NativeFinder

`sys.meta_path.append(NativeFinder)` removed from `bin/az`.

```
browser-cert: FAIL packages/azure-cli/cert/sp.mjs
AssertionError [ERR_ASSERTION]: az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a --certificate /root/cert.pem --tenant 72f988bf-0000-4000-8000-00000000c0de:
ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: No module named 'OpenSSL'
Traceback (most recent call last):
```

## The launcher without isolation

`isolate()` replaced by `sys.path.insert(0, SITE)`: the package's tree is on the path, and site-packages and what a `.pth` imported stay.

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: az group list -o yaml: azure-cli-cert: shadow yaml imported
ERROR: Error loading command module 'resource': module 'yaml' has no attribute 'safe_dump'
azure-cli-cert: fake cryptography imported
```

With `isolate()` removed entirely, az doesn't start at all (no `azure.cli` on the path).

## The launcher without REQUESTS_CA_BUNDLE

`env.setdefault("REQUESTS_CA_BUNDLE", ca)` removed.

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: without CURL_CA_BUNDLE: rc=1
ERROR: HTTPSConnectionPool(host='login.microsoftonline.com', port=443): Max retries exceeded with url: /72f988bf-0000-4000-8000-00000000c0de/v2.0/.well-known/openid-configuration (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain (_ssl.c:1144)')))
```

`login.mjs` still passes on this tarball. requests also reads `CURL_CA_BUNDLE`, which the cert kernel sets. The launcher's default is for an environment without it, and `launcher.mjs` unsets it to check that.

## The launcher without its config defaults

The `env.setdefault(env_name(section, option), value)` loop body removed.

```
browser-cert: FAIL packages/azure-cli/cert/config.mjs
AssertionError [ERR_ASSERTION]: AZURE_CONFIG_DIR=/root/.azure-cert-config  az config get core.collect_telemetry: rc=1
stderr=ERROR: Configuration 'core.collect_telemetry' is not set.
```

## The launcher without its SyntaxWarning filter

```
browser-cert: FAIL packages/azure-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: … /node_modules/@ai-ecoverse/azure-cli/lib/azure-cli/azure/mgmt/resource/deploymentstacks/models/_models.py:119: SyntaxWarning: "\/" is an invalid escape sequence. …
```

## The specs check themselves

- `launcher.mjs` first shows that a plain `python3` imports the shadow `yaml` and runs the `.pth`. Then it shows that az doesn't use them, and that `AZURE_CLI_SITEPACKAGES=1` brings site-packages back.
- `login.mjs` and `sp.mjs` read the stand-in's request log. The device-code, token and ARM requests must be there, with az's client id, the device code and the Bearer token.
- `config.mjs` reads each value's source from `az config get`. After `az config set`, the source is the user's file.
- The stand-in refuses ARM calls without a token it issued, a wrong client secret and blob requests without SharedKey.
