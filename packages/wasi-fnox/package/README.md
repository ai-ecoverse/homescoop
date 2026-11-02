# @ai-ecoverse/wasi-fnox

[fnox](https://fnox.jdx.dev) 1.43 for [slicc](https://github.com/ai-ecoverse/slicc)'s kernel: a WASI preview1 command, `fnox`, built from upstream jdx/fnox v1.43.0 with [homescoop's patch series](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-fnox) (`NNNN-*.patch`, listed in `recipe.yaml`). The patches are carried by homescoop, not upstreamed.

## In seven

Seven's vault holds the secret values, and fnox keeps only placeholders. The vault is reached through slicc-kernel's `/dev/sealed`.

- **Configuration:** bios points fnox at `/etc/fnox` (`FNOX_CONFIG_DIR`). The default provider there is `seven`, of type `sealed`.
- **`fnox set NAME`:**
  - with the value on a pipe, it seals the value and stores the placeholder;
  - on a terminal, it opens the vault's dialog instead of prompting;
  - it refuses a value given as an argument.
- **`fnox get`, `export`, `env`, `hook-env`:** print placeholders.
- **`fnox export`:** prints every secret's value to stdout, as upstream does. A sealed secret's value is its placeholder; a `plain` secret's is the value itself, and so is an `as_file` secret's, since seven can't write it to a file.
- **`fnox export KEY…`:** exports only the named secrets (since 1.42), as upstream: it resolves what they interpolate without exporting it, includes a named `env = false` secret, and fails on an unknown name.
- **`fnox exec -- cmd`:** asks the kernel to hand the command the values its policy allows (`materialize`), then runs it. fnox never sees a value.
- **`fnox exec --shell-grants -- cmd`:** the same for the secrets the vault grants to every shell; the agent's bash hook uses it.
- **`fnox proxy run -- cmd`:** runs the command with placeholders only. The realm proxy fills in values for the rules in `/etc/fnox/config.toml`.
- **`fnox proxy rules --json`:** prints a project's rules as proposals.
- **`fnox check`:** asks the vault about each sealed record.
- **`fnox deactivate`:** removes the shell hooks and the `fnox` function even if the binary is gone (since 1.42.1), as upstream.
- **Refused:** `as_file` secrets, `sync`, `reencrypt`, and `fnox edit` (use `fnox set`).
- **age:** decrypting an age secret isn't supported yet (slicc-vault#2). Encrypting to age recipients works.
- **Other providers:** only `sealed`, `age` and `plain` are built. Values from `plain` are passed on with a warning.
- **Templates:** a secret's `default` and a provider's string fields can use `{{ fnox.profile }}` and `{{ fnox.profiles }}` (Tera, since 1.41), as upstream. A sealed secret's `value`, its placeholder, is never rendered.
- **Not in this build:** leases (including managed identity for `azure-token`), the daemon, the TUI, the MCP server and Lua provider plugins (`fnox plugin`).

It needs slicc-kernel 1.83.0 or later (`engines`): `/dev/sealed` arrived in slicc-kernel 1.68.0 (KS-2), and the exec tickets that `fnox exec` redeems in slicc-kernel 1.83.0 (KS-8).

Without `/dev/sealed`, every sealed operation fails with `not running in seven: /dev/sealed is missing`.

## Licence

fnox is MIT (see `LICENSE`). `THIRD-PARTY-NOTICES.md` lists the crates, Rust's standard library and wasi-libc that `bin/fnox.wasm` links.

## WASI support for fnox 1.43

`fnox exec --only` and `--except` retain upstream filtering: excluded providers are not resolved, dependencies are resolved without being exported, and excluded ambient secret names are removed. Sealed selections still use the kernel ticket path.

Exec output redaction uses helper threads upstream. This WASI build refuses `--redact`, `FNOX_EXEC_REDACT=1`, or `redact_exec = true` before resolving secrets or spawning the child; `--no-redact` overrides the environment and config. Seven retains its kernel handling of sealed output. `proxy run --sandbox` and a configured sandbox are refused before spawning; `--no-sandbox` overrides the config. The OS sandbox, native proxy authentication and private-address enforcement belong to the native proxy, which is compiled out here; seven continues to inject placeholders through its realm proxy.

The new OAuth2, GitLab, Tailscale and Kubernetes lease backends are compiled out with the existing lease backends. `audit`, `scan --values` and `set --generate` retain upstream behavior: audit records names, scan sees sealed placeholders, and generated secrets are created inside fnox before storage (`--show` explicitly prints generated values). Staged scanning and hook installation use native process execution and are unavailable on WASI.
