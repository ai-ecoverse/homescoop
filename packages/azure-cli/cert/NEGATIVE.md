# azure-cli: negative proof

`prove-negative.mjs` can't prove anything here. The package has no WebAssembly of its own: `bin/az` is a Python script, and the interpreter is wasix-python's. So each negative below is a tarball with one part of the packaging undone, repacked with `npm pack` and run through the spec that covers that part. Each spec fails.

## 2.93.0-2: the native packages from the py-* packages

**Date:** 2026-11-18. slicc-kernel 1.191.2 (the cert kernel), wasix-python 3.15.0-10, py-cffi 2.1.1-2, py-pycparser 3.12.0-1, py-cryptography 50.0.2-1, py-pynacl 1.6.2-1, py-bcrypt 5.0.0-1, py-pyopenssl 26.4.0-1, wasm-tls-engine 4.2.0-12, Chromium through `scripts/browser-cert/run.mjs`, users enforce. The base is a local build of 2.93.0-2 (sha256 `0fb366b4…6377`), which passes every spec.

### Without the py-* packages: 2.93.0-1

The published 2.93.0-1 tarball (sha256 `6ae7f169…3233`), whose launcher takes no site-packages at all, run through the new specs with the py-* packages installed beside it. Every spec that needs native code fails at its first command:

```
browser-cert: FAIL packages/azure-cli/cert/certificate.mjs
stderr=ERROR: This command needs pyOpenSSL (it needs cryptography, native code). @ai-ecoverse/azure-cli has only pure-Python code, so that it runs on wasix-python, and doesn't include it (No module named 'OpenSSL').
browser-cert: FAIL packages/azure-cli/cert/keyvault.mjs
AssertionError [ERR_ASSERTION]: AZURE_CONFIG_DIR=/root/.azure-cert-keyvault az keyvault key import --vault-name certvault -n cert-key-1 --pem-file /root/kv-key.pem: rc=1
stderr=ERROR: This command needs cryptography (native code: Rust and OpenSSL). …
browser-cert: FAIL packages/azure-cli/cert/native.mjs
AssertionError [ERR_ASSERTION]: az keyvault list: rc=1
browser-cert: FAIL packages/azure-cli/cert/sshkeys.mjs
AssertionError [ERR_ASSERTION]: … az aks create -g cert-rg -n certaks --location westeurope --generate-ssh-keys …: rc=1
browser-cert: FAIL packages/azure-cli/cert/webapp.mjs
stderr=ERROR: This command needs PyNaCl (native code: libsodium). …
```

`az keyvault secret set` and `show` alone pass on 2.93.0-1: they are SDK commands that never import keyvault's `custom.py`. That's why `keyvault.mjs` also imports a key, which reads the PEM with cryptography.

### The launcher reopened to site-packages

`isolate()` with `sys.path[:] = [SITE] + keep + gone`: every site-packages directory stays (wasix-python's own, then each py-* that discovery found), instead of only az's own py-* packages. That's what letting discovery hand az its native packages would do (sha256 `cf942eb5…f4d0`).

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: az keyvault list: rc=1
azure-cli-cert: fake cryptography imported
ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: No module named 'cryptography.hazmat'
```

The fake cryptography in wasix-python's site-packages comes before py-cryptography and wins. `native.mjs` fails too: sys.path has wasix-python's own site-packages, not only az's six.

```
browser-cert: FAIL packages/azure-cli/cert/native.mjs
+   '/node_modules/@ai-ecoverse/wasix-python/lib/python3.15/site-packages',
```

### The launcher without the version check

`own_packages()` with `elif m.get("name") != npm:` in place of the name and version check (sha256 `6455ab1e…5949`). A py-bcrypt whose package.json says 5.0.0-99 is taken:

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: []
0 !== 1
```

That's `az webapp list`, which should stop with "This command needs bcrypt, from @ai-ecoverse/py-bcrypt, which az couldn't use: … is @ai-ecoverse/py-bcrypt 5.0.0-99, az needs @ai-ecoverse/py-bcrypt 5.0.0-1".

### The launcher without the dependency check

`own_packages()` with its loop over each py-* package's own py-* dependencies turned off (`changed = False`). `test/launcher.test.mjs` fails on the host:

```
✖ another version, a missing package, another ABI, another python: refused, with the reason
✖ a py-* package's own dependency must be the copy az takes
```

py-cryptography is taken without az's py-cffi, and with a nested py-cffi of its own that isn't the one az puts on sys.path.

### The launcher without its NativeFinder

`sys.meta_path.append(NativeFinder)` removed from `bin/az` (sha256 `9f69779c…d3e7`). psutil's import in az's `try` is then a plain `No module named 'psutil'`, and the launcher's reason is gone:

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
DEBUG: cli.azure.cli.core.util: No module named 'psutil'
browser-cert: FAIL packages/azure-cli/cert/native.mjs
AssertionError [ERR_ASSERTION]: … (the debug log, without "This command needs psutil (native code), which has no WASIX build")
```

### storage-encryption-without-cryptography.patch

Dropped in 2.93.0-2: with py-cryptography, the storage SDKs load unpatched. `storage.mjs` now checks that they are unpatched and that their client-side encryption ciphers work; `test/files.test.mjs` checks that the patch is gone and the SDKs import cryptography at module level.

## 2.93.0-1

**Date:** 2026-11-17. slicc-kernel 1.189.2 (the cert kernel), wasix-python 3.15.0-8, wasm-tls-engine 4.2.0-12, Chromium through `scripts/browser-cert/run.mjs`, users enforce.

This is a new package, so the first certification is by a person. It isn't in `scripts/ci-certified.json`.

Each negative below is the 2.93.0-1 tarball (sha256 `74144f09…8dc1`) with one part of the packaging undone. The specs named are the 2.93.0-1 ones; where 2.93.0-2 changed a spec, the section above has the new negative.

### can-launch-browser-wasi.patch reverted

`lib/azure-cli/azure/cli/core/util.py` back to upstream's `if platform_name != 'linux':`.

```
browser-cert: FAIL packages/azure-cli/cert/login.mjs
AssertionError [ERR_ASSERTION]: az login: rc=124
WARNING: A web browser has been opened at https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize. Please continue the login in the web browser. If no web browser is available or if the web browser fails to open, use device code flow with `az login --use-device-code`.
```

No browser opened. az waits on MSAL's localhost listener until `timeout 180` ends it.

### storage-encryption-without-cryptography.patch reverted (the patch is gone in 2.93.0-2)

`azure/storage/blob/_encryption.py` back to its module-level `from cryptography…` imports.

```
browser-cert: FAIL packages/azure-cli/cert/storage.mjs
AssertionError [ERR_ASSERTION]: AZURE_CONFIG_DIR=/root/.azure-cert-storage az storage account list: rc=1
stderr=ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: 'NoneType' object is not iterable
```

The storage module's arguments name data-plane models. azure-cli-core's `get_sdk()` swallows the ImportError and returns None, so every `az storage` command fails, even the ARM one.

### The launcher without its NativeFinder

`sys.meta_path.append(NativeFinder)` removed from `bin/az`.

```
browser-cert: FAIL packages/azure-cli/cert/sp.mjs
AssertionError [ERR_ASSERTION]: az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a --certificate /root/cert.pem --tenant 72f988bf-0000-4000-8000-00000000c0de:
ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: No module named 'OpenSSL'
Traceback (most recent call last):
```

### The launcher without isolation

`isolate()` replaced by `sys.path.insert(0, SITE)`: the package's tree is on the path, and site-packages and what a `.pth` imported stay.

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: az group list -o yaml: azure-cli-cert: shadow yaml imported
ERROR: Error loading command module 'resource': module 'yaml' has no attribute 'safe_dump'
azure-cli-cert: fake cryptography imported
```

With `isolate()` removed entirely, az doesn't start at all (no `azure.cli` on the path).

### The launcher without REQUESTS_CA_BUNDLE

`env.setdefault("REQUESTS_CA_BUNDLE", ca)` removed.

```
browser-cert: FAIL packages/azure-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: without CURL_CA_BUNDLE: rc=1
ERROR: HTTPSConnectionPool(host='login.microsoftonline.com', port=443): Max retries exceeded with url: /72f988bf-0000-4000-8000-00000000c0de/v2.0/.well-known/openid-configuration (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain (_ssl.c:1144)')))
```

`login.mjs` still passes on this tarball. requests also reads `CURL_CA_BUNDLE`, which the cert kernel sets. The launcher's default is for an environment without it, and `launcher.mjs` unsets it to check that.

### The launcher without its config defaults

The `env.setdefault(env_name(section, option), value)` loop body removed.

```
browser-cert: FAIL packages/azure-cli/cert/config.mjs
AssertionError [ERR_ASSERTION]: AZURE_CONFIG_DIR=/root/.azure-cert-config  az config get core.collect_telemetry: rc=1
stderr=ERROR: Configuration 'core.collect_telemetry' is not set.
```

### The launcher without its SyntaxWarning filter

```
browser-cert: FAIL packages/azure-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: … /node_modules/@ai-ecoverse/azure-cli/lib/azure-cli/azure/mgmt/resource/deploymentstacks/models/_models.py:119: SyntaxWarning: "\/" is an invalid escape sequence. …
```

### The specs check themselves

- `launcher.mjs` first shows that a plain `python3` imports the shadow `yaml` and runs the `.pth`. Then it shows that az doesn't use them, and that `AZURE_CLI_SITEPACKAGES=1` brings site-packages back.
- `login.mjs` and `sp.mjs` read the stand-in's request log. The device-code, token and ARM requests must be there, with az's client id, the device code and the Bearer token.
- `config.mjs` reads each value's source from `az config get`. After `az config set`, the source is the user's file.
- The stand-in refuses ARM calls without a token it issued, a wrong client secret and blob requests without SharedKey.

### The launcher without QuietPipe

`sys.stdout = QuietPipe(sys.stdout)` removed from `bin/az`.

```
browser-cert: FAIL packages/azure-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: ERROR: The command failed with an unexpected error. Here is the traceback:
ERROR: [Errno 64] Broken pipe
Traceback (most recent call last):
  File "/node_modules/@ai-ecoverse/wasix-python/lib/python3.15/argparse.py", line 2911, in print_help
```

That's `az vm list --help | head -3`, which upstream az does the same way.

### A license text missing

The tarball's `THIRD-PARTY-NOTICES.md` without its antlr4-python3-runtime section. The antlr4 wheel ships no license file of its own.

```
browser-cert: FAIL packages/azure-cli/cert/notices.mjs
AssertionError [ERR_ASSERTION]: THIRD-PARTY-NOTICES.md: antlr4-python3-runtime: no "## " heading names it
```

The build doesn't get that far. `src/install.py` run with a `licenses.map` that has no antlr4 line stops with:

```
install.py: antlr4-python3-runtime 4.13.1 ships no license file and licenses.map has no text for it
```
