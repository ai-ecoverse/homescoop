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
