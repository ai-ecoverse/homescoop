# `@ai-ecoverse/azure-cli`

The Azure CLI: az, to manage Azure resources from slicc.

This is Microsoft's own Azure CLI, release 2.93.0, not a reimplementation. It
runs on `@ai-ecoverse/wasix-python`, which it installs, with the Python
packages upstream pins for the release. Upstream syntax works as documented:
`az group list`, `az resource list`, `az vm list -o table`,
`az network vnet list`, `az storage account list`,
`az storage blob upload --account-name … --account-key …`,
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
client secret, or with a federated token:

```sh
az login --service-principal -u <app id> -p <client secret> --tenant <tenant id>
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
  shell launcher does (`python -m azure.cli`), with only the standard library
  and this package's `lib/azure-cli` on the path. Packages installed beside it
  (`py-*`, `pip install`) can't replace one of az's modules. Set
  `AZURE_CLI_SITEPACKAGES=1` to put site-packages back, after az's own. It
  also sets `REQUESTS_CA_BUNDLE` to `SSL_CERT_FILE`, the CA of slicc's network
  proxy, because `requests` reads only `REQUESTS_CA_BUNDLE` or
  `CURL_CA_BUNDLE`. Set `REQUESTS_CA_BUNDLE` yourself to use another bundle.
- **Two small patches** (in the recipe): plain `az login` checks for a browser
  on WASI as it does on Linux, so it falls back to the device code instead of
  waiting for a browser, and the storage SDKs load without `cryptography`,
  which only their client-side encryption needs.
- **Speed.** Nothing is precompiled, so each run compiles what it imports:
  about 1–2 s for `az version`, and 3–5 s for `az group list` or a sign-in.
  azure-cli-core's packaged command index means a first run doesn't load
  every command module.

## What's not available

This package has only pure-Python code. Upstream's closure also has native
code: cryptography, PyNaCl, bcrypt, cffi and psutil, and pyOpenSSL, paramiko,
fabric, scp and sshtunnel, which need them. Commands that need them stop with
one error that names the missing package:

```
ERROR: This command needs cryptography (native code: Rust and OpenSSL). @ai-ecoverse/azure-cli has only pure-Python code, so that it runs on wasix-python, and doesn't include it (No module named 'cryptography').
```

- `az keyvault` (all of it), `az iot`, `az sf`, `az bot`, `az batchai`, and
  `az ams content-key-policy` need cryptography.
- `az webapp`, `az functionapp`, `az logicapp` and `az staticwebapp` need PyNaCl.
- Signing in with a service principal's certificate
  (`az login --service-principal --certificate`) needs pyOpenSSL. Use a
  client secret or a federated token.
- `--generate-ssh-keys` needs cryptography. Make a key with `ssh-keygen`
  (`@ai-ecoverse/wasix-openssh`) and pass it with `--ssh-key-values`.
- az's own SSH (paramiko, fabric, scp, sshtunnel), as in
  `az webapp create-remote-connection`, isn't there.
- Commands that download and run a native binary (`az bicep`,
  `az aks install-cli`) don't work here.
- Client-side encryption in the storage SDKs, which az doesn't offer, needs
  cryptography.

Licensed under the MIT License (`LICENSE` is upstream's). The Python packages
under `lib/azure-cli` keep their own licenses. `THIRD-PARTY-NOTICES.md` lists
each one with its license and where its license text is.
