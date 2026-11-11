# `@ai-ecoverse/gcloud-cli`

The Google Cloud CLI: gcloud and bq, to manage Google Cloud and query BigQuery from slicc.

This is Google's own Cloud SDK, release 593.0.0, not a reimplementation. It
runs on `@ai-ecoverse/wasix-python`, which it installs. Upstream syntax
works as documented: `gcloud projects list`, `gcloud compute instances list`,
`gcloud run services list`, `bq query --use_legacy_sql=false 'SELECT 1'`,
`bq ls`, `bq head`.

| Command | What runs |
| --- | --- |
| `gcloud` | `lib/google-cloud-sdk/lib/gcloud.py` |
| `bq` | `lib/google-cloud-sdk/bin/bootstrapping/bq.py`, which runs the BigQuery CLI in `platform/bq` with gcloud's credentials |

`gcloud alpha` and `gcloud beta` are included.

## Signing in

```sh
gcloud auth login
```

In slicc there's no browser for gcloud to open, so gcloud picks its
"remote" flow by itself (the same as `--no-launch-browser`). It prints an
`accounts.google.com` link. Open it, sign in and allow access, and Google
shows a code on `https://sdk.cloud.google.com/authcode.html`. Paste that code
at the prompt. gcloud keeps the credentials in `~/.config/gcloud/`, and `bq`
uses them too. Nothing redirects to `localhost`, so the flow doesn't touch a
protected origin.

Google offers no device-code flow for Cloud scopes (`cloud-platform`,
`bigquery` and `compute` are not on its device-flow scope list), so
`gcloud auth login` can't print a short code to enter at
`google.com/device`. See homescoop#2037.

Without a person at the keyboard, hand gcloud an access token as upstream
documents (`CLOUDSDK_AUTH_ACCESS_TOKEN`, or `--access-token-file`). `bq`
takes it from gcloud:

```sh
CLOUDSDK_AUTH_ACCESS_TOKEN=… gcloud projects list
CLOUDSDK_AUTH_ACCESS_TOKEN=… bq ls bigquery-public-data:samples
```

## What's different from a normal install

- **No component manager.** `gcloud components install|update|remove` stop
  with "this Google Cloud CLI installation is managed by an external package
  manager", as on Google's apt and yum packages. To update, install a newer
  version of this package. `gcloud components list` still shows what's
  installed: core, gcloud-deps, bq, alpha and beta.
- **No update checks, usage reporting or survey prompts**, set in the
  installation's `properties` file. `gcloud config set` overrides them per
  user.
- **Not included:** `gsutil` (use `gcloud storage`), Google's bundled CPython,
  the `gcloud-crc32c` helper binary, the App Engine dev server,
  `docker-credential-gcloud` and `git-credential-gcloud.sh`.
- **Launchers:** `bin/gcloud` and `bin/bq` are one Python script that does
  what Google's shell launchers do. It sets `CLOUDSDK_ROOT_DIR`, sets
  `CLOUDSDK_PYTHON` to this interpreter, and runs without site-packages
  (`-S`), so the SDK's vendored libraries win over any `py-*` package. It
  also points `CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE` at `SSL_CERT_FILE`, the
  CA of slicc's network proxy, which `bq` needs to verify TLS. Set
  `CLOUDSDK_PYTHON_SITEPACKAGES=1` to keep site-packages on the path, or set
  `CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE` yourself to use another bundle.
- **Commands that need a native extension or binary** (gRPC streaming,
  `kubectl`, the emulators, App Engine's Java tools) aren't available.

bq's vendored `requests` warns on every run (`RequestsDependencyWarning`)
that its vendored urllib3 and charset_normalizer aren't versions it lists;
Google's install prints it too. The launcher adds one `PYTHONWARNINGS`
filter that ignores exactly that warning from module `requests`, after any
filters of yours.

Licensed under the Apache License 2.0 (`LICENSE` is Google's), with the
third-party libraries under `lib/google-cloud-sdk/lib/third_party` and
`platform/bq/third_party` under their own licenses, which are kept beside
them.
