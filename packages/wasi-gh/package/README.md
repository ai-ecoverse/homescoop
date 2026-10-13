# @ai-ecoverse/wasi-gh

[GitHub CLI](https://cli.github.com) 2.102.0 as a WASI preview1 command for
SLICC: `gh`. On `@ai-ecoverse/slicc-kernel` ≥ 1.30.0, `host/gh-host.mjs`
(loaded through `slicc.commands.gh.imports`) sends its HTTP requests and
starts the commands it runs. The `gh` command sets `"preopenRoot": true`, so
the kernel preopens `/` and gh can walk up from a repository to find `.git`.

`bin/gh.wasm` is built by homescoop from gh's source (v2.102.0, commit
`fc4b137`) with Go 1.27.1 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`)
and `patches/0001-wasip1-slicc-host.patch`, so it is not an upstream gh
release. The patch stubs terminals, the clipboard and file locks for wasip1,
and routes `http.DefaultTransport` (what go-gh uses) and commands started
through gh's `internal/run` helper to the host module.

Authenticate with `GH_TOKEN` or `GITHUB_TOKEN`, or with a token in
`hosts.yml`. The keyring is not available on wasip1. Commands that run `git`
need [`@ai-ecoverse/wasm-git`](https://www.npmjs.com/package/@ai-ecoverse/wasm-git)
installed in the same kernel.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## What works

On slicc-kernel, with the host module:

- `gh version` and `gh --version`
- `gh help` and the help text of a subcommand
- `gh api`, including an absolute `http:` or `https:` URL. Requests go through
  the kernel's network (`net-request`), so `https://api.github.com` works when
  the kernel has a network transport and `GH_TOKEN` is set
- local git operations gh performs itself (`git rev-parse`, reading remotes)
  when `git` is `@ai-ecoverse/wasm-git`

## What does not work

- In a runtime without this host module, HTTP and commands fail with
  `this runtime cannot start commands or open network connections for gh (it needs slicc-kernel with @ai-ecoverse/wasi-gh's host module)`.
- Interactive prompts, the bubbletea and tcell screens, the clipboard, and a
  pager. wasip1 has no terminal ioctls here.
- `gh auth login` in a browser, device flow that has to open a URL, and the
  OS keyring. Pass `GH_TOKEN` instead.
- SSH, codespaces, `gh copilot`, and extensions that are native binaries.
- A git credential helper that has to start `gh` again from inside
  `@ai-ecoverse/wasm-git`. Cloning a private repository over HTTPS needs git's
  own credentials, or a public URL.
- Telemetry. gh tries to spawn itself to send it and ignores the failure.
