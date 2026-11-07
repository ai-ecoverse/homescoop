# @ai-ecoverse/wasi-fnox

[fnox](https://fnox.jdx.dev) 1.45 for [slicc](https://github.com/ai-ecoverse/slicc)'s kernel: a WASI preview1 command, `fnox`, built from upstream jdx/fnox v1.45.0 with [homescoop's patch series](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-fnox) (`NNNN-*.patch`, listed in `recipe.yaml`). The patches are carried by homescoop, not upstreamed.

## In seven

Seven's vault holds the secret values, and fnox keeps only placeholders. The vault is reached through slicc-kernel's `/dev/sealed`.

- **Configuration:** bios points fnox at `/etc/fnox` (`FNOX_CONFIG_DIR`). The default provider there is `seven`, of type `sealed`.
- **`fnox set NAME`:**
  - with the value on a pipe, it seals the value and stores the placeholder;
  - on a terminal, it opens the vault's dialog in seven's approvals instead of prompting: one `ask` to `/dev/sealed` with `replace: true`, then one blocking read until you answer. Over a name the vault already has, the dialog takes a new value, which keeps its placeholder. `--description` is shown as the dialog's prompt (up to 200 characters). Ctrl-C exits 130, and the kernel withdraws the dialog. A denied or expired dialog exits 1 and stores nothing;
  - it refuses a value given as an argument.
- **`fnox set NAME --ask`:** opens the same dialog when stdin isn't a terminal, for example from the agent's bash. It never reads stdin. It prints only the placeholder on stdout, so `PH=$(fnox set NAME --ask)` works, and prints its status on stderr. It can't be combined with a value, `--from-file` or `--generate`.
- **`fnox set` with an `age` or `plain` provider:** with no value on a pipe (on a terminal, or with `--ask`), it asks the dialog with `reveal: true`. fnox gets the value you type and stores what it normally stores: the age ciphertext, or the plaintext for `plain` (and for a secret with no provider). The vault keeps its own sealed copy, so the value is still scrubbed from what the agent sees. A policy that refuses reveals to the agent (`[reveal] agent = false`) refuses `--ask` from the agent's bash for these providers. Other providers are refused before any dialog opens.
- **`fnox get`, `export`, `env`, `hook-env`:** print placeholders.
- **`fnox export`:** prints every secret's value to stdout, as upstream does. A sealed secret's value is its placeholder; a `plain` secret's is the value itself, and so is an `as_file` secret's, since seven can't write it to a file.
- **`fnox export KEY…`:** exports only the named secrets (since 1.42), as upstream: it resolves what they interpolate without exporting it, includes a named `env = false` secret, and fails on an unknown name.
- **`fnox exec -- cmd`:** asks the kernel to hand the command the values its policy allows (`materialize`), then runs it. fnox never sees a value.
- **`fnox exec --shell-grants -- cmd`:** the same for the secrets the vault grants to every shell; the agent's bash hook uses it.
- **`fnox proxy run -- cmd`:** runs the command with placeholders only. The realm proxy fills in values for the rules in `/etc/fnox/config.toml`.
- **`fnox proxy rules --json`:** prints a project's rules as proposals.
- **`fnox check`:** asks the vault about each sealed record.
- **`fnox deactivate`:** removes the shell hooks and the `fnox` function even if the binary is gone (since 1.42.1), as upstream.
- **Refused:** `as_file` secrets, `sync`, `reencrypt`, `fnox edit`, `fnox files`, and `fnox set|get --file` (use `fnox set` / `fnox get`).
- **age:** decrypting an age secret isn't supported yet (slicc-vault#2). Encrypting to age recipients works.
- **Other providers:** only `sealed`, `age` and `plain` are built. Values from `plain` are passed on with a warning.
- **Templates:** a secret's `default` and a provider's string fields can use `{{ fnox.profile }}` and `{{ fnox.profiles }}` (Tera, since 1.41), as upstream. A sealed secret's `value`, its placeholder, is never rendered.
- **Not in this build:** leases (including managed identity for `azure-token`), the daemon, the TUI, the MCP server (including `request_secret`), secret-file write paths, and Lua provider plugins (`fnox plugin`).

It needs slicc-kernel 1.175.0 or later (`engines`): `/dev/sealed` arrived in slicc-kernel 1.68.0 (KS-2), the exec tickets that `fnox exec` redeems in slicc-kernel 1.83.0 (KS-8), and the `ask` op that the vault dialog of `fnox set` uses in slicc-kernel 1.175.0. On an older kernel the dialog fails with `seven: /dev/sealed refused ask: EINVAL`, and a piped `fnox set` still works.

Without `/dev/sealed`, every sealed operation fails with `not running in seven: /dev/sealed is missing`.

## Licence

fnox is MIT (see `LICENSE`). `THIRD-PARTY-NOTICES.md` lists the crates, Rust's standard library and wasi-libc that `bin/fnox.wasm` links.

## WASI support for fnox 1.45

`fnox exec --only` and `--except` retain upstream filtering: excluded providers are not resolved, dependencies are resolved without being exported, and excluded configured values are not injected. Inherited environment variables retain their original values unless the child plan replaces or removes them; these flags do not clear the environment. The WASI child starts from the environment captured before resolution, so a resolved interpolation dependency cannot enter it through process-environment mutation. Sealed selections still use the kernel ticket path.

Exec output redaction uses helper threads upstream. This WASI build refuses `--redact`, `FNOX_EXEC_REDACT=1`, or `redact_exec = true` before resolving secrets or spawning the child; `--no-redact` overrides the environment and config. Seven retains its kernel handling of sealed output. `proxy run --sandbox` and a configured sandbox are refused before spawning; `--no-sandbox` overrides the config. The OS sandbox, native proxy authentication and private-address enforcement belong to the native proxy, which is compiled out here; seven continues to inject placeholders through its realm proxy.

The new OAuth2, GitLab, Tailscale and Kubernetes lease backends are compiled out with the existing lease backends. `audit`, `scan --values` and `set --generate` retain upstream behavior: audit records names, scan sees sealed placeholders, and generated secrets are created inside fnox before storage (`--show` explicitly prints generated values). Staged scanning and hook installation use native process execution and are unavailable on WASI.

Since 1.45.0, upstream secret files (`[files]`, `fnox files`, `set|get|edit --file`) and the MCP `request_secret` one-time page need native HTTP, tempfile and editor paths. This build refuses those commands and flags before they run; the MCP module and the native proxy HTTP stack stay compiled out.
