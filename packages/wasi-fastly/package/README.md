# @ai-ecoverse/wasi-fastly

The [Fastly CLI](https://www.fastly.com/documentation/reference/cli/) 17.2.0
as a WASI preview1 command for SLICC: `fastly`. On
`@ai-ecoverse/slicc-kernel` ≥ 1.187.0, `host/fastly-host.mjs` (loaded
through `slicc.commands.fastly.imports`) sends its HTTP requests through the
kernel's network and sets the modes of its config files.

`bin/fastly.wasm` is built by homescoop from Fastly's source (v17.2.0,
commit `23a945d`) with Go 1.27.3 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
-trimpath`) and upstream's release ldflags, then `wasm-opt -Oz`, so it is not
an upstream release. The patches:

- `patches/0001-wasip1-build.patch`: wasip1 files for the two modules that
  don't build for it (go-ps and otiai10/copy).
- `patches/0002-wasip1-slicc-host.patch`: HTTP through the host module
  (`http.DefaultTransport`, and go-fastly's client on wasip1), modes for the
  config directory, `config.toml` and `errors.log`, and a piped token for
  `fastly auth login`.
- `patches/0003-wasip1-unavailable-commands.patch`: the commands listed
  under *What does not work* stop with their reason. There is no update
  check and no build-data notice.
- `patches/0004-lazy-oidc-metadata.patch`: a command with an API token makes
  no request to `accounts.fastly.com` before its own. Upstream fetches the
  OpenID Connect metadata before every such command.

On slicc-kernel's Cloudflare kernel (`createCloudflareKernel`), fastly runs in
a Dynamic Worker, and the kernel calls the host module's
`createAsyncImports`, whose `fastly_host.call` is async, so JSPI suspends
fastly.wasm while a request is answered. A Dynamic Worker takes at most
64 MiB of code. fastly.wasm is about 49.5 MB, and `build.sh` fails a build
over 62 MiB.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## Authentication

Use an API token. Create one at
<https://manage.fastly.com/account/personal/tokens>, then do one of these:

- set `FASTLY_API_TOKEN` (in seven, from the vault). Every request carries
  it as `Fastly-Key`, and the embedder's transport sees that header, so it
  can put a real token in place of a placeholder;
- `fastly auth add <name> --api-token <token>`;
- `fastly auth login`, then paste the token. wasip1 can't turn off the
  terminal's echo, so the pasted token is shown as you type it. A piped
  token (`printf '%s\n' "$TOKEN" | fastly auth login`) works too.

A stored token goes into `~/.config/fastly/config.toml`
(`$XDG_CONFIG_HOME/fastly/config.toml` when that is set), in plain text,
mode 0600 in a 0700 directory, so other users of the kernel can't read it.
`errors.log` next to it records each failing command line, `--token`
included, and is 0600 too.

**SSO doesn't work.** `fastly auth login --sso` (and `fastly sso`, `fastly
profile create --sso`) waits for the browser to come back to
`http://localhost:8080/callback`, and a slicc command can't receive that
redirect. They exit 1 and say to use a token.

## What works

On slicc-kernel, with the host module:

- `fastly version`, `fastly --help` and the help of every command;
- the commands that call the Fastly API: `service` (with its backends, VCL
  and versions), `domain`, `dns`, `tls-*`, `kv-store`, `config-store`,
  `secret-store`, `stats`, `whoami`, `auth` and the rest. Requests go to `https://api.fastly.com` through the
  kernel's network. The cert covers `service list` and `service create`;
- `--json` output, and prompts answered from stdin (`-y`, `-i` or a pipe).

## What does not work

- In a runtime without the host module, API calls fail with
  `this runtime cannot open network connections for fastly (it needs slicc-kernel with @ai-ecoverse/wasi-fastly's host module)`.
  `fastly version` and `--help` still run.
- Building Compute packages: `fastly compute build`, `compute publish` and
  `compute hash-files` without `--package` run the project's language
  toolchain and wasm-tools, which are native programs. Build where the
  toolchain is installed, then deploy here with
  `fastly compute deploy --package pkg/<name>.tar.gz` (not covered by the
  cert).
- `fastly compute serve` (Viceroy, a native program, on a local port),
  `compute init` (git and the starter kit's scripts) and
  `compute install-tools` (it downloads Viceroy).
- `fastly update` and `fastly install`: they replace the binary. Install
  another version of this package instead.
- SSO (above), and opening a browser.
- A hidden prompt for the token: there are no terminal ioctls on wasip1.
