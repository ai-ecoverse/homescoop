# @ai-ecoverse/wasi-ntfy

The [ntfy](https://ntfy.sh) 2.32.0 client as a WASI preview1 command for
SLICC: `ntfy`, with `ntfy publish` (`pub`) and `ntfy subscribe` (`sub`). It is
seven's replacement for six's webhooks. A webhook, a phone or another agent
publishes to a topic, and `ntfy sub <topic> '<command>'` runs the command in
seven for each message. The connection is outbound only, because a tab can't
listen. It works against [ntfy.sh](https://ntfy.sh), any ntfy server, and the
ntfy gateway at `https://ntfy.sliccy.ai` (ai-ecoverse/sliccy-ai, "The ntfy
gateway").

On `@ai-ecoverse/slicc-kernel` ≥ 1.125.4, `host/ntfy-host.mjs` (loaded through
`slicc.commands.ntfy.imports`) sends ntfy's HTTP requests through the kernel's
network (`net-request`, `net-read`) and starts the commands `ntfy sub` runs.

`bin/ntfy.wasm` is built by homescoop from ntfy's source (tag v2.32.0, commit
`9d0b6d9`). It uses Go 1.27.1 with `GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0
-trimpath -tags noserver`, which is upstream's `make cli-client` build: the
client only, with no server, no SQLite and no web app. Two patches are
applied (see [Patches](#patches)), so this isn't an upstream ntfy release.
The build is reproducible.

## Seven usage

The gateway's owner mints a `tk_` token per consumer (`scopes`: `subscribe`,
`publish`, `hooks`; optional `topics`). Keep the token in the vault and pass
it as `NTFY_TOKEN` or `--token`. Prefer that over `?auth=`, which puts the
token in URLs.

Subscribe, and turn every message into a `webhook` lick for the cone:

```sh
NTFY_TOKEN=tk_… ntfy sub https://ntfy.sliccy.ai/github \
  'agent send cone --lick=webhook --source github "$NTFY_RAW"'
```

Publish (needs a token with `publish`):

```sh
NTFY_TOKEN=tk_… ntfy pub --title 'Build' https://ntfy.sliccy.ai/alerts 'deploy finished'
echo 'from stdin' | ntfy pub https://ntfy.sliccy.ai/alerts
```

Poll once and exit, instead of streaming:

```sh
ntfy sub --poll --since 10m https://ntfy.sliccy.ai/github
```

Or put the defaults in `~/.config/ntfy/client.yml`
(`$XDG_CONFIG_HOME/ntfy/client.yml` when that is set):

```yaml
default-host: https://ntfy.sliccy.ai
default-token: tk_…
subscribe:
  - topic: github
    command: 'agent send cone --lick=webhook --source github "$NTFY_RAW"'
```

Then use `ntfy pub alerts hi`, `ntfy sub github '<command>'`, or
`ntfy sub --from-config`. With `--from-config`, an auth error on any one
subscription ends the command.

The command runs as `sh -c '<command>'`, once per message, in order, one at a
time. Its stdin, stdout and stderr are ntfy's own. It gets ntfy's own
environment plus `NTFY_ID`, `NTFY_TIME`, `NTFY_TOPIC`, `NTFY_MESSAGE`,
`NTFY_TITLE`, `NTFY_PRIORITY`, `NTFY_TAGS` and `NTFY_RAW`, with upstream's
short aliases (`$m`, `$t`, `$raw`, …). `NTFY_RAW` is the message's JSON line
as the server sent it, so the fields the gateway adds (`headers`, `verified`,
`hook`, `attachment.url` for bodies it stores as attachments) reach the
command. `NTFY_TITLE`, `NTFY_MESSAGE`, `NTFY_TAGS`, `NTFY_PRIORITY` and
`NTFY_TOPIC` are also flags of `ntfy pub`, so a command that publishes again
should `unset ${!NTFY_*}` first. Otherwise its `ntfy pub` takes the incoming
message's topic and fields.

The command runs as the user who started `ntfy sub`, with that user's
privileges, files and environment. Treat everything in a message (`NTFY_*`)
as untrusted input: anyone who can publish to the topic, or post to a hook
URL of it, chooses those values. They arrive as data in the environment, so a
message's `$(…)` or backticks are not run unless the command itself `eval`s
them. Quote them (`"$NTFY_MESSAGE"`), and never paste them into a shell
command line. `--token` is not passed to the command's environment;
`NTFY_TOKEN` is, if you set it in ntfy's own.

## The gateway's contract

| The gateway | What the client does |
| --- | --- |
| `tk_` tokens are scoped. A subscribe-only token's publish gets 403; no token or a forged one gets 401. | `ntfy pub` prints the server's error and exits 1 (upstream). `ntfy sub` exits 1 on 401 or 403 instead of retrying every 10 s (patched). |
| 429 with `retry-after: 60` past 10 claims a minute per IP, or 300 messages or deliveries a minute per home. | `ntfy sub` waits for the longer of `Retry-After` and its usual 10 s before it reconnects. `ntfy pub` waits `Retry-After` and sends the message (or the `--file` upload) again, at most twice. It fails at once, naming the wait, when the wait is over 5 minutes or the body can't be sent again (`--file -`) (patched). |
| At most 8 open streams per token. A subscriber more than 1 MiB behind is dropped. | After any drop, `ntfy sub` reconnects after 10 s with `since=<last message id>` and skips a repeat of that message, so nothing is lost or run twice. Before the first message it resumes from the time of the stream's `open` event (patched). A ninth stream is refused by the gateway; use one `ntfy sub` with several topics (`a,b`) or `--from-config`. |
| A JSON publish (`POST /`) is capped at 1 MiB. | The CLI never sends a JSON publish; it posts the message to `/<topic>`. A message over 1 MiB, from arguments, `--message` or stdin, is refused before any request (`message is over the 1 MiB limit (1048576 bytes); send it as an attachment with --file instead`). Upstream cut stdin at 1 MiB without a word (patched). `--file` uploads aren't capped by the client; the gateway takes bodies up to 25 MiB. |
| Message lines stay under 60 KiB; larger bodies become `attachment`s. | Lines up to 4 MiB are read (upstream: 64 KiB) (patched). |
| Revoking a token answers `{ revoked, hooks }` and ends its streams. | That's the owner's API, not the CLI's. A `ntfy sub` on the revoked token reconnects, gets 401 and exits 1. |

## Patches

- `0001-wasip1-slicc-host.patch`: the wasip1 build files upstream lacks
  (`cmd/*_unix.go` and `client/config_unix.go` exclude wasip1), and
  `slicchost`, which talks to `host/ntfy-host.mjs` through the `ntfy_host`
  imports. `http.DefaultTransport` sends requests there and reads each
  response chunk as it arrives. Before each blocking read it yields to the
  other goroutines, so a message's command runs as soon as its line arrives,
  not when the next one does (wasip1 Go has one thread, and a host call
  blocks all of it). The `ntfy sub` command and `pub --wait-cmd` run through
  the host's spawn. `--wait-pid` fails with a clear error.
- `0002-gateway-contract.patch`: resuming with `since=`, `Retry-After`, auth
  errors ending `ntfy sub`, the 1 MiB refusal and the longer line limit
  described above. Upstream's own reconnect waits 10 s and resubscribes with
  the original options ("may lose messages").

## What does not work

- In a runtime without this host module, every request fails with
  `this runtime cannot start commands or open network connections for ntfy (it needs slicc-kernel with @ai-ecoverse/wasi-ntfy's host module)`.
- `ntfy serve` and the server's admin commands (`user`, `access`, `token`,
  `tier`, `webpush`): this is the client build.
- Desktop notifications. `ntfy sub` without a command prints each message's
  JSON line, as upstream does on Linux.
- `ntfy pub --wait-pid`: there's no process table to watch.
- A password prompt (`--user name` without `:password`) needs a terminal.
  Pass `--user name:password` or a token.

## Licence

ntfy is dual-licensed, Apache-2.0 or GPL-2.0-only, at your choice. This
package is distributed under both, like upstream (`LICENSE`, `LICENSE.GPLv2`).
Homescoop's patches are under the same terms. `THIRD-PARTY-NOTICES.md` lists
the Go runtime and every module `ntfy.wasm` links, with their licences.
