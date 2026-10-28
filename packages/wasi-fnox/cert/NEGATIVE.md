# wasi-fnox: negative proof

Each run below is a build with patches removed, checked against the cert. Every one fails in the case that maps to the removed patches (`meta.json` `patches`). The full series (0001–0013) passes both `cert/checklist.mjs` and `test/sealed.mjs`. All runs were on slicc-kernel 1.83.0 (Node entry, macOS arm64, 2026-10-14).

## Shared build only (0001–0005, no seven patches)

`cert/checklist.mjs` fails at its first seven-specific assertion. 0003 compiles the proxy command out on WASI and 0009 brings it back, so `fnox --help` has no `proxy` command:

```text
CERT FAIL The input did not match the regular expression /\n  proxy /.
```

## Without 0013 (terminal detection on WASI)

`test/sealed.mjs` fails at case 6, `set` on a terminal. atty reports no terminal on wasm, so fnox waits for stdin to end and never sends `request {kind: "value"}`:

```text
ok   re-seal by uid 0 over a human-entered value is allowed (the double enforces EEXIST for others)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
'hung' !== 0
    at …/packages/wasi-fnox/test/sealed.mjs:100:8
```

## Without 0012 (`exec --shell-grants`)

`test/sealed.mjs` fails at case 9: fnox rejects the unknown flag, so no `materialize {shellGrants: true}` is sent:

```text
ok   exec sends materialize {names, path /usr/bin/fnox, argv, cwd} and fails closed on the vault's refusal
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  actual: undefined,
    at …/packages/wasi-fnox/test/sealed.mjs:153:8   (sg.shellGrants === true)
```

## 1.39.0-1 (without 0014): `fnox edit` traps

`cert/checklist.mjs` fails at the `fnox edit` case. 1.39.0-1, the published package, panics in `std::env::temp_dir()` and traps (homescoop#376):

```text
Error:   × Main thread panicked.
  ├─▶ at /rustc/48a229ce…/library/std/src/sys/paths/wasi.rs:44:5
  ╰─▶ not supported by WASI yet
fnox: wasm trap: unreachable          (status 134)
```

## 1.39.0-2: `proxy run` hands a disabled provider's credentials to the child

`cert/checklist.mjs` fails at the homescoop#401 case on the published 1.39.0-2 (slicc-kernel 1.83.0, 2026-10-16). Its 0002 gave every provider the WASI build compiles out an empty `env_dependencies()`, so `proxy run` removed only its fixed list (`OP_SERVICE_ACCOUNT_TOKEN`, `BW_SESSION`, `VAULT_TOKEN`, …) and not the configured providers' own names, as upstream does:

```text
browser-cert: FAIL packages/wasi-fnox/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: proxy run handed FNOX_OP_SERVICE_ACCOUNT_TOKEN to the child (homescoop#401)
```

1.39.0-2's child also got `FNOX_BW_SESSION` and `FNOX_VAULT_NAMESPACE`. `fnox exec` is not part of this case: upstream v1.39.0's `exec` passes these variables through to the child as well (it removes only `FNOX_AGE_KEY`, `FNOX_AGE_KEY_FILE` and Enpass's password), and so does the WASI build.

## 1.39.0-3 (without 0015): `fnox hook-env` traps, `fnox activate` recurses

`cert/checklist.mjs` fails at the homescoop#400 case on 1.39.0-3 (slicc-kernel 1.83.0, 2026-10-16). hook-env keys its session with `std::process::id()`, which panics on WASI:

```text
browser-cert: FAIL packages/wasi-fnox/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: hook-env trapped: Error:   × Main thread panicked.
  ├─▶ at /rustc/48a229ce…/library/std/src/sys/process/unsupported.rs:336:5
  ╰─▶ no pids on this platform
```

With only the hook-env half of 0015, `eval "$(fnox activate bash)"; _fnox_hook` in wasm-bash ran out of stack (`RangeError: Maximum call stack size exceeded` in bash.wasm, `LVL` empty): the printed hook called a bare `fnox` inside its own `fnox()` function. 0015 prints `/usr/bin/fnox`.

## 1.39.0-4 (0015 before #554): `fnox activate` with no fnox on PATH

`cert/checklist.mjs` fails at the new `activate` case. The published 1.39.0-4, run as `/usr/bin/fnox activate bash` with `PATH=/nonexistent`, falls back to a bare `fnox`, which the `fnox()` wrapper it prints calls recursively (slicc-kernel 1.102.6, users kernel default, 2026-10-17):

```text
browser-cert: FAIL cert/checklist.mjs
AssertionError [ERR_ASSERTION]: activate with no fnox on PATH: export FNOX_SHELL=bash

fnox() {
  …
  if [ "$#" = 0 ]; then
    fnox
    return
  fi
  …
    fnox "$command" "$@"
  …
  eval "$(fnox hook-env -s bash)"
```

1.39.0-5 names `/usr/bin/fnox` there. The `export` case with an `as_file` secret passes on 1.39.0-4 too: it fills a test gap and isn't a fix.

## 1.39.0-6: exec with an as_file secret, activate and the exec bit (homescoop#945, #1129, 2026-10-20)

The published 1.39.0-5 against -6's checklist (slicc-kernel 1.134.3, users enforce): **FAIL, 6 of 94 assertions.**
- `fnox exec -- printenv LVL` in a project that also has an `as_file` secret fails with `fnox::seven × not available in seven: the value would be in a program (use a header rule)`.
- With a mode-644 `/tmp/bin/fnox` ahead of `/usr/bin` on PATH, `fnox activate bash` pins `/tmp/bin/fnox` into the hook.

A first -6 build that only dropped the file secrets from the plan still passed `CERT=pem-data` to the child: fnox's own environment held the resolved value. -6 removes the key from the child's environment.


## 1.40.0-1: the series on v1.40.0 (2026-10-23)

The published 1.39.0-6 against 1.40.0-1's checklist (slicc-kernel 1.134.3, users kernel default): **FAIL, 11 of 118 assertions.**
- `fnox --version` prints 1.39.0.
- A `fnox.toml` with a `kubernetes` or a `lua` provider, or a `plain` provider with `file` and `format`, doesn't parse (`unknown variant 'kubernetes'`). So `get` of the file-backed plain secrets (absolute and relative), the kubernetes provider's "not available in the WASI build" error and `proxy run` with those providers configured all fail.

## 1.40.0-1 without 0017: a plain provider with a file traps

The series on v1.40.0 without 0017 passes the checklist up to the new `file` case, where `fnox get FROMFILE` traps. v1.40.0's plain provider reads the file with tokio::fs, on a blocking-pool thread WASI can't spawn:

```text
AssertionError [ERR_ASSERTION]: 1.40.0 plain provider with a file: Error:   × Main thread panicked.
  ├─▶ at /cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.53.2/
  │   src/fs/mod.rs:317:11
  ╰─▶ OS can't spawn worker thread: Not supported (os error 58)
fnox: wasm trap: unreachable
134 !== 0
```

With 0017 the checklist and `test/sealed.mjs` pass (slicc-kernel 1.134.3 and 1.83.0, macOS arm64).

## 1.40.0-1: Azure's SERVICE_PRINCIPAL_ENV_VARS through 0002's const_list

From v1.40.0, the Azure providers' `env_dependencies()` returns the constant `SERVICE_PRINCIPAL_ENV_VARS` (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) instead of a literal list. 0002's build-time reader resolves that constant from azure_shared.rs. The checklist configures an `azure-sm` provider in `v140scrub` and asserts that `proxy run` keeps all three variables from the child.

**No runtime leak can be shown.** A 1.40.0-1 build whose const_list returns `&[]` for every named constant was checked: the generated `env_dependencies()` had no AZURE name for azure-sm, azure-kms or azure-ac. That build still passes the checklist, all 118 assertions (slicc-kernel 1.134.3, 2026-10-23). The three names are also in `proxy run`'s fixed `AMBIENT_CREDENTIAL_ENV_VARS`, so the child never gets them either way. The row guards against upstream renaming the constant or the fixed list; it can't catch const_list alone.

A const_list that is missing or broken fails the build instead. The 1.39.0 series' 0002 on v1.40.0 panics in build.rs with `src/providers/azure_kms.rs: env_dependencies() is not a literal list: SERVICE_PRINCIPAL_ENV_VARS`. A constant no provider module defines panics with `env_dependencies() names <X>, which no provider module defines`.

## 1.40.0-1: a relative plain `file`

`file = "conf/secrets.json"` (`format = "json"`) resolves against the config file's directory: `fnox get` prints the file's value from the project root and from `sub/dir`, with PWD set to each (0004's cwd). 1.39.0-6 fails both, because a `plain` provider with `file` doesn't parse.

## 1.41.0-1: the series on v1.41.0 (2026-10-26)

The published 1.40.0-1 against 1.41.0-1's checklist (slicc-kernel 1.134.3, users kernel default, `run.mjs --soft`): **FAIL, 17 of 149 assertions.** 1.41.0-1 passes all 149.
- `fnox --version` prints 1.40.0.
- **gopass:** a `fnox.toml` with a `gopass` provider doesn't parse (`unknown variant 'gopass'`). So `get` of a gopass secret doesn't fail with "provider type 'gopass' is not available in the WASI build of fnox", and `proxy run` with a gopass provider configured fails before it runs the child. 1.41.0-1's 0002 compiles the provider out and reads its `env_dependencies()` (`GNUPGHOME`, `GOPASS_HOMEDIR`, `GOPASS_CONFIG_NOWRAP`) from gopass.rs. None of the three is on `proxy run`'s fixed list (`AMBIENT_CREDENTIAL_ENV_VARS`), so unlike Azure's const_list row this one can show a leak: a 1.41.0-1 build whose gopass.rs `env_dependencies()` returns `&[]` fails the checklist at exactly these 3 assertions (`proxy run handed a configured gopass provider's GNUPGHOME to the child`, and the same for `GOPASS_HOMEDIR` and `GOPASS_CONFIG_NOWRAP`; 146 of 149 pass). A list the reader can't parse fails the build instead, as before.
- **Templates:** `fnox get STAGE` (`default = "{{ fnox.profile }}"`) prints `{{ fnox.profile }}`, with and without `-P staging`, instead of `default` and `staging`. A `{% raw %}` block isn't unwrapped. `default = "{{ nope }}"` prints itself and exits 0 instead of failing with "default of secret 'BAD'". A plain provider with `file = "conf/{{ fnox.profile }}.json"` fails with `failed to read '/home/v141/conf/{{ fnox.profile }}.json'`. `fnox -P staging exec -- printenv STAGE TPLTOKEN` doesn't print `staging` and `token-for-staging`.
- **exec and an unused `env = false` secret:** `fnox exec --if-missing error -- printenv LVL`, in a project that also has `UNUSED = { provider = "k8s", value = "app-secret", env = false }`, fails with `Error resolving secret 'UNUSED': ... provider type 'kubernetes' is not available`. 1.40.0's exec resolves every secret in the profile; 1.41.0's resolves only the ones it injects and what they depend on (upstream #984). `UNUSED` stays out of the command's environment on both.

`test/sealed.mjs` passes on 1.41.0-1 (slicc-kernel 1.83.0, macOS arm64).

## 1.42.0-1: the series on v1.42.0 (2026-10-28)

The published 1.41.0-1 against 1.42.0-1's checklist (slicc-kernel 1.134.3, users kernel default, `run.mjs --soft`): **FAIL, 10 of 176 assertions.** 1.42.0-1 passes all 176.
- `fnox --version` prints 1.41.0.
- **export with named keys** (upstream #1002): `fnox export --if-missing error LVL`, `fnox export --if-missing error --format json URL GH`, `fnox export --if-missing error HIDDEN`, `fnox export --if-missing error GF` and `fnox export LVX` all fail with `error: unexpected argument 'LVL' found` (and the same for `URL`, `HIDDEN`, `GF` and `LVX`), so the row's checks fail: only LVL printed although the unnamed `UNUSED` (a kubernetes secret) can't resolve, URL with its interpolated HOST resolved but not exported and the sealed GH as its placeholder, the named `env = false` HIDDEN exported, the named sealed `as_file` GF exported as its placeholder only, and `Did you mean 'LVL'?` for the unknown key.

Two parts of the new row pass on 1.41.0-1 too. They show that 1.42.0's new code stays gated out on WASI, and they don't fix anything:
- **azure-token with managed identity** (upstream #1003): `fnox exec -- printenv LVL` and `fnox get AI_ACCESS_TOKEN`, in a project whose azure-token lease sets `auth = "managed-identity"` and `managed_identity_client_id`, fail with "leases are not available in the WASI build of fnox", without a trap, and print nothing. 1.41.0-1 ignores the two new fields and fails the same way. On 1.42.0-1, the lease's `check_prerequisites` now reads its `auth` setting (`AzureAuth`, which azure_shared builds on WASI) and passes, so the refusal comes from 0003's lease ledger, as for every other lease. The managed-identity credential (azure_identity's IMDS client) is never built, because 0003 compiles out `AzureTokenBackend`.
- **`fnox sync --local-file`** (upstream #1004) is refused with 0010's message, like `fnox sync`. Only `sync` loads a config without the local sync cache, so 1.42.0's `local_source` handling never runs on WASI.

Before the fix in 0003, the series on v1.42.0 didn't build: `git apply` stopped at `crates/fnox-core/src/lease_backends/azure_token.rs:32`. A three-way rebase applied 0003's hunks, but `cargo check --target wasm32-wasip1` then failed with `cannot find type AzureAuth in this scope` (E0433, three times in `check_prerequisites`), because 0003 imported `AzureAuth` only off WASI. 0003 now keeps the import on all targets.

`test/sealed.mjs` passes on 1.42.0-1 (slicc-kernel 1.83.0, macOS arm64).
