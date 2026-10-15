# @ai-ecoverse/wasi-gh

[GitHub CLI](https://cli.github.com) 2.102.0 as a WASI preview1 command for
SLICC: `gh`. On `@ai-ecoverse/slicc-kernel` ≥ 1.30.0, `host/gh-host.mjs`
(loaded through `slicc.commands.gh.imports`) sends its HTTP requests and
starts the commands it runs. The `gh` command sets `"preopenRoot": true`, so
the kernel preopens `/` and gh can walk up from a repository to find `.git`.

`bin/gh.wasm` is built by homescoop from gh's source (v2.102.0, commit
`fc4b137`) with Go 1.27.1 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath`)
and `patches/0001-wasip1-slicc-host.patch` plus
`patches/0002-wasip1-gh-browser.patch`, so it is not an upstream gh
release. The patches stub terminals and file locks for wasip1, copy text
through `pbcopy` or `xclip` when one of those is on `PATH`, and route
`http.DefaultTransport` (what go-gh uses) and commands started through gh's
`internal/run` helper to the host module.

In seven, use `GH_TOKEN` from the vault. `gh auth login` stores a
plain-text token under `GH_CONFIG_DIR`, which is not how seven keeps
secrets. Outside seven, authenticate with `GH_TOKEN` or `GITHUB_TOKEN`,
or with that token file. The keyring is not available on wasip1.

Commands that run `git`
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
- `GH_BROWSER` (or `BROWSER`). `gh auth login --web` runs that command with
  the device URL, including when stdin is a pipe (`yes | gh auth login -w`).
  `@ai-ecoverse/slicc-cdp`'s `playwright-cli open` is the command that opens
  a tab when the kernel has a CDP host on port 9222
- copying and pasting text when `pbcopy`/`pbpaste`, `xclip`, `xsel`, or
  `wl-copy`/`wl-paste` is on `PATH`. `gh auth login -c` runs the first of
  `pbcopy`, `xclip -in -selection clipboard`, `xsel --input --clipboard`,
  and `wl-copy` that exists. A missing command is skipped. A non-zero exit
  is clipboard unavailable, and login still prints the one-time code.
  Paste uses `pbpaste`, `xclip -out -selection clipboard`,
  `xsel --output --clipboard`, or `wl-paste --no-newline`. The copy is text
- local git operations gh performs itself (`git rev-parse`, reading remotes)
  when `git` is `@ai-ecoverse/wasm-git`. The process stdin is inherited by
  that git, so an interactive shell is not read to EOF before git starts

## What does not work

- In a runtime without this host module, HTTP and commands fail with
  `this runtime cannot start commands or open network connections for gh (it needs slicc-kernel with @ai-ecoverse/wasi-gh's host module)`.
- Interactive prompts, the bubbletea and tcell screens, and a pager.
  wasip1 has no terminal ioctls here. `gh auth login -w -p https` skips
  those prompts. Without a clipboard command on `PATH`, `-c` prints the
  one-time code after the copy fails.
- The OS keyring. A successful `gh auth login` stores the token in plain
  text under `GH_CONFIG_DIR`. Pass `GH_TOKEN` to skip login.
- SSH, codespaces, `gh copilot`, and extensions that are native binaries.
- A git credential helper that has to start `gh` again from inside
  `@ai-ecoverse/wasm-git`. Cloning a private repository over HTTPS needs git's
  own credentials, or a public URL.
- Telemetry. gh tries to spawn itself to send it and ignores the failure.
