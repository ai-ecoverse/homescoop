# @ai-ecoverse/wasi-newrelic

The [New Relic CLI](https://github.com/newrelic/newrelic-cli) 0.117.0 as a
WASI preview1 command for SLICC: `newrelic`. On
`@ai-ecoverse/slicc-kernel` ≥ 1.187.0, `host/newrelic-host.mjs` (loaded
through `slicc.commands.newrelic.imports`) sends its HTTP requests
(NerdGraph, REST) through the kernel's network and sets the modes of its
config files.

```sh
pnpm add -g @ai-ecoverse/wasi-newrelic
NEW_RELIC_API_KEY=NRAK-… newrelic nerdgraph query '{ actor { user { name } } }'
```

`bin/newrelic.wasm` is built by homescoop from New Relic's source (v0.117.0,
commit `05ba094`) with Go 1.27.4 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
-trimpath`) and upstream's release ldflags, so it is not an upstream
release. The patches:

- `patches/0001-wasip1-build.patch`: wasip1 files for the packages that
  don't build for it (logrus, survey's terminal, mvdan.cc/sh's interpreter,
  the install validation). Prompts are refused: see *What does not work*.
- `patches/0002-wasip1-slicc-host.patch`: HTTP through the host module
  (`http.DefaultTransport`, which newrelic-client-go's client uses), and
  modes for `~/.newrelic` and the files in it.
- `patches/0003-wasip1-unavailable-commands.patch`: `newrelic install` and
  `newrelic diagnose run`, `update` and `lint` stop with their reason.

On slicc-kernel's Cloudflare kernel (`createCloudflareKernel`), newrelic runs
in a Dynamic Worker, and the kernel calls the host module's
`createAsyncImports`, whose `newrelic_host.call` is async, so JSPI suspends
newrelic.wasm while a request is answered. A Dynamic Worker takes at most
64 MiB of code. newrelic.wasm is about 38.4 MB, and `build.sh` fails a build
over 62 MiB.

Apache-2.0; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## Authentication

Use a User API key (`NRAK-…`), from
<https://one.newrelic.com/api-keys>, then do one of these:

- set `NEW_RELIC_API_KEY` (in seven, from the vault), and
  `NEW_RELIC_ACCOUNT_ID` and `NEW_RELIC_REGION` (`US` or `EU`) where a
  command needs them. Every request carries the key as `Api-Key`, and the
  embedder's transport sees that header, so it can put a real key in place
  of a placeholder;
- `newrelic profile add --profile <name> --apiKey <key> --region US
  --accountId <id> --licenseKey <key>`, with every value as a flag (or
  `-y` for the ones it can work out).

A profile goes into `~/.newrelic/credentials.json` in plain text, mode 0600
in a 0700 directory, so other users of the kernel can't read it. Upstream
asks for 0640 in 0750; this build drops the group bits too. `config.json`
next to it is 0600 as well.

## What works

On slicc-kernel, with the host module:

- `newrelic version`, `newrelic --help` and the help of every command;
- the commands that call New Relic's APIs: `nerdgraph`, `nrql`, `entity`,
  `apm`, `apiAccess`, `events`, `synthetics`, `workload`, `nerdstorage`,
  `changeTracking`, `accessmanagement`, `usermanagement`, `fleetcontrol`,
  `edge`, `aimonitoring` (with `--yes` where it asks), `diagnose validate`
  and the rest. Requests go to `https://api.newrelic.com` (or
  `api.eu.newrelic.com`) through the kernel's network. The cert covers
  `nerdgraph query` and `nrql query`;
- the local commands: `profile`, `config`, `decode`, `utils`, `agent config`.

## What does not work

- In a runtime without the host module, API calls fail with
  `this runtime cannot open network connections for newrelic (it needs slicc-kernel with @ai-ecoverse/wasi-newrelic's host module)`,
  after newrelic-client-go's retries (about 7 s). `newrelic version` and
  `--help` still run.
- Prompts. wasip1 has no terminal raw mode, and on slicc-kernel's cooked
  terminal a prompt would hang, waiting for its cursor query to be
  answered. A value left to a prompt fails with
  `cannot prompt: WASI preview1 has no terminal raw mode; pass the value as a flag`:
  pass it as a flag, or `-y` / `--yes`.
- `newrelic install`: its recipes are shell scripts that install agents
  and integrations on the machine itself, with its package manager and
  sudo. Run it on the host you want to instrument.
- `newrelic diagnose run`, `update` and `lint`: they download and start New
  Relic Diagnostics (`nrdiag`), a native program.
- `newrelic migrate`'s Terraform commands, which start `terraform`: a WASI
  command can't start programs, so they fail when they try.
