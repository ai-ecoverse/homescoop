# gcloud-cli: negative proof

**Date:** 2026-11-11. slicc-kernel 1.178.2 (the cert kernel), wasix-python 3.15.0-8, Chromium through `scripts/browser-cert/run.mjs`.

This is a new package, so the first certification is by a person. It isn't in `scripts/ci-certified.json`.

`prove-negative.mjs` can't prove anything here. The package has no WebAssembly of its own: `bin/gcloud` and `bin/bq` are Python scripts, and the interpreter is wasix-python's. So the negatives below are tarballs of the 593.0.0-1 build with one part of the packaging undone, run through the same specs.

## The component manager left on

The negative: `lib/googlecloudsdk/core/config.json` with `"disable_updater": false`, as Google ships it.

```
browser-cert: FAIL packages/gcloud-cli/cert/components.mjs
AssertionError [ERR_ASSERTION]: gcloud components install kubectl: ERROR: gcloud crashed (ProxyError): HTTPSConnectionPool(host='dl.google.com', port=443): Max retries exceeded with url: /dl/cloudsdk/channels/rapid/components-v593.0.0.json (…Tunnel connection failed: 501 Not Implemented)
```

With the updater on, gcloud goes to the network to install, and with a network it would write into the package. With the build's `disable_updater: true` it stops first, with Google's "managed by an external package manager".

## No install state, no installation properties, and site-packages on the path

The negative: one tarball without `.install/` and without `properties`. Its launchers also don't strip site-packages or add `-S` to `CLOUDSDK_PYTHON_ARGS`.

```
browser-cert: ok packages/gcloud-cli/cert/auth.mjs
browser-cert: FAIL packages/gcloud-cli/cert/components.mjs
AssertionError [ERR_ASSERTION]: gcloud components install kubectl: ERROR: (gcloud.components.install) The components management action could not be performed because the installation root of the Cloud SDK could not be located. …
browser-cert: FAIL packages/gcloud-cli/cert/config.mjs
AssertionError [ERR_ASSERTION]: {
browser-cert: FAIL packages/gcloud-cli/cert/launcher.mjs
AssertionError [ERR_ASSERTION]: site-packages on gcloud's path:
browser-cert: FAIL packages/gcloud-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: cat '/node_modules/@ai-ecoverse/gcloud-cli/lib/google-cloud-sdk/.install/alpha.snapshot.json': rc=1
cert-run: FAIL gcloud-cli fail
```

`auth.mjs` passes on that tarball, as it should. The remote flow is gcloud's own, and none of the removed parts affect it.

## bq without the kernel's CA

This one was run by hand, before the launcher set `CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE`. On slicc-kernel's Node entry with wasm-tls-engine, a fetch transport and an access token, `bq query` failed:

```
BigQuery error in query operation: Could not connect with BigQuery server due
to: SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate
verify failed: self-signed certificate in certificate chain (_ssl.c:1144)')
```

The kernel's proxy terminates TLS with its own CA. bq's httplib2 trusts only its own bundle or `--ca_certificates_file`, which gcloud's bq wrapper fills from `core/custom_ca_certs_file`. With the launcher's default, the same call reached BigQuery: `bq ls` and `bq head` on `bigquery-public-data:samples` returned rows. `config.mjs` checks that the property is set.

## The specs check themselves

- `launcher.mjs` first shows that its `.pth` probe fires in a plain `python3`, then that the probe doesn't fire under gcloud or bq's child python, and then that it fires again with `CLOUDSDK_PYTHON_SITEPACKAGES=1`.
- `auth.mjs` parses the authorize URL and checks each parameter separately.
- `version.mjs` compares the whole `gcloud version` output with the versions in the snapshots.

## bq's RequestsDependencyWarning

The negative: the 593.0.0-1 tarball with the launcher's `QUIET` filter replaced by `ignore:nothing-at-all`.

```
browser-cert: FAIL packages/gcloud-cli/cert/version.mjs
AssertionError [ERR_ASSERTION]: bq version stderr:
…RequestsDependencyWarning: urllib3 (1.26.9) or chardet (None)/charset_normalizer (3.5.2) doesn't match a supported version!
```

`version.mjs` also runs `platform/bq/bq.py` without the launcher, and that run must print the warning. So the filter, not a change in bq, is what keeps stderr empty.
