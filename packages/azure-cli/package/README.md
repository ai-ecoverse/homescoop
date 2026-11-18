# `@ai-ecoverse/azure-cli`

The Azure CLI: az, to manage Azure resources from slicc.

This is Microsoft's own Azure CLI, release 2.93.0, not a reimplementation. It
runs on `@ai-ecoverse/wasix-python`, which it installs, with the Python
packages upstream pins for the release. The ones with native code
(cryptography, PyNaCl, bcrypt, cffi) and pyOpenSSL come from homescoop's
`@ai-ecoverse/py-*` packages, built for wasix-python, which it installs too.
Upstream syntax works as documented:
`az group list`, `az resource list`, `az vm list -o table`,
`az network vnet list`, `az storage account list`,
`az storage blob upload --account-name … --account-key …`,
`az keyvault secret set --vault-name … -n … --value …`, `az webapp list`,
`az functionapp list`, `az aks create … --generate-ssh-keys`,
`az aks list`, `az role assignment list`, `az rest`.

## Signing in

```sh
az login
```

There's no browser for az to open in slicc, so az uses the device code flow by
itself (the same as `az login --use-device-code`). It prints a line like:

```
To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code L7W6V5NYM to authenticate.
```

Open the page, enter the code and sign in. az then lists your subscriptions
and keeps the login in `~/.azure`. Nothing redirects to `localhost`.

Without a person at the keyboard, sign in as a service principal with a
client secret, a certificate (a PEM file with the private key and the
certificate), or a federated token:

```sh
az login --service-principal -u <app id> -p <client secret> --tenant <tenant id>
az login --service-principal -u <app id> --certificate ~/sp.pem --tenant <tenant id>
az login --service-principal -u <app id> --federated-token <token> --tenant <tenant id>
az account get-access-token
```

`az account get-access-token` prints the current access token, for `curl` and
other tools.

## What's different from a normal install

- **Defaults for slicc.** Telemetry (`core.collect_telemetry`), the survey
  prompt (`core.survey_message`), installing an extension on demand
  (`extension.use_dynamic_install`) and the first-run welcome, which says the
  CLI collects usage data, are off. Each default applies only while your az
  config doesn't set the option, so `az config set core.collect_telemetry=yes`
  and the like win. `az config get` shows where each value comes from.
- **The token cache is plain JSON** (`~/.azure/msal_token_cache.json`, mode
  0600), as on Linux by default. `core.encrypt_token_cache` stays off, because
  there's no keyring to encrypt with.
- **Extensions:** `az extension add --name <name>` (or `--source <wheel>`)
  installs pure-Python extensions with wasix-python's pip. A command from an
  extension that isn't installed is reported as not found. az doesn't offer to
  install it, unless you set `az config set extension.use_dynamic_install=yes_prompt`.
- **Updates:** install a newer version of this package. `az upgrade` can't
  update it. Like upstream, az looks for a newer release on its first run and
  in `az --version` (at most once a day).
- **The launcher.** `bin/az` is a Python script that does what upstream's
  shell launcher does (`python -m azure.cli`), with only the standard library,
  this package's `lib/azure-cli` and the `py-*` packages it depends on on the
  path, in that order. It finds those as Node would from its own directory
  (npm or pnpm), and takes each only at the exact version its `package.json`
  pins, built for the python that runs it. Other packages installed beside it
  (other `py-*`, `pip install`) can't replace one of az's modules. Set
  `AZURE_CLI_SITEPACKAGES=1` to put the rest of site-packages back, after
  az's own. It also sets `REQUESTS_CA_BUNDLE` to `SSL_CERT_FILE`, the CA of
  slicc's network proxy, because `requests` reads only `REQUESTS_CA_BUNDLE` or
  `CURL_CA_BUNDLE`. Set `REQUESTS_CA_BUNDLE` yourself to use another bundle.
- **One small patch** (in the recipe): plain `az login` checks for a browser
  on WASI as it does on Linux, so it falls back to the device code instead of
  waiting for a browser.
- **Newer native packages than upstream pins.** azure-cli 2.93.0 pins
  cryptography 48.0.1, bcrypt 3.2.0, pyOpenSSL 26.2.0 and cffi 2.0.0; this
  package has the homescoop builds of cryptography 50.0.2, bcrypt 5.0.0,
  pyOpenSSL 26.4.0 and cffi 2.1.1 (PyNaCl 1.6.2 is upstream's). Every range
  that azure-cli and the packages it pins declare accepts them (msal takes
  cryptography below 51, pyOpenSSL 26.4.0 takes 49 to 50, paramiko takes
  bcrypt 3.2 or later).
- **A closed pipe** (`az vm list --help | head`) ends az quietly with status
  141, as it does a C program, instead of an "unexpected error" traceback.
- **Speed.** Nothing is precompiled, so each run compiles what it imports:
  about 1–2 s for `az version`, and 3–5 s for `az group list` or a sign-in.
  azure-cli-core's packaged command index means a first run doesn't load
  every command module.

## What needs native code

These work, with the `py-*` packages:

- `az keyvault` (all of it), `az iot`, `az sf`, `az bot`, `az batchai` and
  `az ams content-key-policy` (cryptography, pyOpenSSL).
- `az webapp`, `az functionapp`, `az logicapp` and `az staticwebapp`
  (PyNaCl, which seals the publish profile `az webapp deployment
  github-actions add` stores as a GitHub secret).
- Signing in with a service principal's certificate (pyOpenSSL reads it,
  cryptography signs the client assertion).
- `--generate-ssh-keys` (`az aks create`, `az vm create`, `az lab vm create`):
  an RSA key in `~/.ssh/id_rsa` (mode 0600) and `~/.ssh/id_rsa.pub`.
- Client-side encryption in the storage SDKs.

## What's not available

- **psutil** (native code, no WASIX build) isn't included. az only asks it
  for the parent process's name (for telemetry, which is off, and a quoting
  hint for PowerShell), in a `try`, so nothing fails; `--debug` says why:

  ```
  DEBUG: cli.azure.cli.core.util: This command needs psutil (native code), which has no WASIX build; @ai-ecoverse/azure-cli doesn't include it (No module named 'psutil').
  ```

- Commands that download and run a native binary (`az bicep`,
  `az aks install-cli`) don't work here.
- **SSH connections.** paramiko, fabric, scp and sshtunnel are there and load,
  but an SSH session needs an outbound TCP connection, which slicc gives only
  through an uplink (tailnet), not through its web proxy. So
  `az webapp create-remote-connection`, `az webapp ssh` and `az batchai`'s
  SSH commands aren't certified. `az ssh` is an extension
  (`az extension add --name ssh`) that runs OpenSSH's `ssh` command, which is
  `@ai-ecoverse/wasix-openssh` in slicc, and isn't certified either.
- An extension whose dependencies have native code doesn't install:
  `az extension add` runs pip, which builds nothing native in slicc.

If a `py-*` package that az depends on is missing, or isn't the version this
package pins (an install that went wrong, or one replaced by hand), the
command that needs it stops with one error that says which and why:

```
ERROR: This command needs cryptography, from @ai-ecoverse/py-cryptography, which az couldn't use: it isn't installed beside az (az needs 50.0.2-1) (No module named 'cryptography').
```

Install `@ai-ecoverse/azure-cli` again to fix it.

Licensed under the MIT License (`LICENSE` is upstream's). The Python packages
under `lib/azure-cli` keep their own licenses. `THIRD-PARTY-NOTICES.md` lists
each one with its license and where its license text is. For the 22 packages
whose wheel ships no license file, the text is in `THIRD-PARTY-NOTICES.md`
itself: ANTLR's, isodate's and asn1crypto's, wcwidth's, scp's
(LGPL-2.1-or-later), and the Azure SDK for Python's MIT license for the
older `azure-*` packages. paramiko and scp are LGPL-2.1-or-later,
unmodified Python source. The `py-*` packages carry their own licenses.
