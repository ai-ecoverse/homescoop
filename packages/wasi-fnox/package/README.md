# @ai-ecoverse/wasi-fnox

[fnox](https://fnox.jdx.dev) 1.39 for [slicc](https://github.com/ai-ecoverse/slicc)'s kernel: a WASI preview1 command, `fnox`, built from upstream jdx/fnox v1.39.0 with [homescoop's patch series](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-fnox) (`NNNN-*.patch`, listed in `recipe.yaml`). The patches are carried by homescoop, not upstreamed.

## In seven

Seven's vault holds the secret values, and fnox keeps only placeholders. The vault is reached through slicc-kernel's `/dev/sealed`.

- **Configuration:** bios points fnox at `/etc/fnox` (`FNOX_CONFIG_DIR`). The default provider there is `seven`, of type `sealed`.
- **`fnox set NAME`:**
  - with the value on a pipe, it seals the value and stores the placeholder;
  - on a terminal, it opens the vault's dialog instead of prompting;
  - it refuses a value given as an argument.
- **`fnox get`, `export`, `env`, `hook-env`:** print placeholders.
- **`fnox exec -- cmd`:** asks the kernel to hand the command the values its policy allows (`materialize`), then runs it. fnox never sees a value.
- **`fnox proxy run -- cmd`:** runs the command with placeholders only. The realm proxy fills in values for the rules in `/etc/fnox/config.toml`.
- **`fnox proxy rules --json`:** prints a project's rules as proposals.
- **`fnox check`:** asks the vault about each sealed record.
- **Refused:** `as_file` secrets, `sync` and `reencrypt`.
- **age:** decrypting an age secret isn't supported yet (slicc-vault#2). Encrypting to age recipients works.
- **Other providers:** only `sealed`, `age` and `plain` are built. Values from `plain` are passed on with a warning.
- **Not in this build:** leases, the daemon, the TUI and the MCP server.

Without `/dev/sealed`, every sealed operation fails with `not running in seven: /dev/sealed is missing`.

## Licence

fnox is MIT (see `LICENSE`). `THIRD-PARTY-NOTICES.md` lists the crates, Rust's standard library and wasi-libc that `bin/fnox.wasm` links.
