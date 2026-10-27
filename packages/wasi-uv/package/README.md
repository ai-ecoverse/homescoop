# `@ai-ecoverse/wasi-uv`

[Astral's uv](https://github.com/astral-sh/uv) 0.13 as a WASI command for
[slicc](https://github.com/ai-ecoverse/slicc)'s kernel, running against
[`@ai-ecoverse/wasix-python`](https://www.npmjs.com/package/@ai-ecoverse/wasix-python).
It replaces [`@ai-ecoverse/wasix-uv-shim`](https://www.npmjs.com/package/@ai-ecoverse/wasix-uv-shim)
(both provide `uv`: install one).

```bash
pnpm add -g @ai-ecoverse/wasi-uv
uv venv && uv pip install requests && uv run python -c 'import requests'
uv init demo && cd demo && uv add idna && uv run demo
uvx --from charset-normalizer normalizer file.txt   # uvx is uv tool run, as upstream's
```

PyPI is reached through the kernel's proxy (`HTTPS_PROXY`, CA in
`SSL_CERT_FILE`, both set by the kernel). Checked in the kernel: `uv venv`,
`uv pip install|list|uninstall`, `uv init`, `uv add`, `uv remove`,
`uv lock`, `uv sync`, `uv tree`, `uv run` (python, modules, console
scripts), `uv tool install|run|uninstall`, `uv pip compile`, `uv pip check`,
`uv export` (requirements.txt and `--format pylock.toml`) and installing from a `pylock.toml`, sdist builds (PEP 517, e.g. setuptools) and `--compile-bytecode`.

Limits in seven:

- **Wheels:** the interpreter's platform tag is `wasi_0_0_0_wasm32`, which
  PyPI has no wheels for. Pure-Python wheels and sdists install; compiled
  packages come from homescoop's `@ai-ecoverse/py-*` npm packages.
- **No git dependencies** (uv spawns git through code that cannot spawn on
  WASI yet), no `uv python install`, no `uv self update`.
- **File locks are record locks** (since 0.13.1-2, homescoop#706): uv's locks
  on a cache, an environment or a project are whole-file `fcntl` locks in
  slicc-kernel (`slicc.fcntl_lock`, ≥ 1.100.0), so two uv processes on one
  cache or environment are serialised: the second says `Waiting to acquire
  exclusive lock`, and `uv cache clean` waits for running uv processes. Up
  to 0.13.1-1 every lock was granted without one. Since slicc-kernel 1.119.0
  the locks also exclude across browser tabs (slicc-kernel#944), and since
  1.120.1 what's written under them is coherent across tabs
  (slicc-kernel#949). On older kernels, don't rely on two tabs sharing a
  cache or an environment.
- Files are copied from the cache into environments (`UV_LINK_MODE=copy`,
  set by the command).
- **Ending uv:** ^C at a terminal and `kill -9` end a running uv, and the
  kernel drops its locks, so the next uv on that cache or environment goes
  ahead (slicc-kernel ≥ 1.104.1, the package's floor since 0.13.1-4; older
  kernels could lose a `kill -9` and leave a lock held, homescoop#910).
- **`uv export` can list an extra it shouldn't (homescoop#1920):** uv
  reverted a `uv export` fix it had since 0.13.0, from 0.13.3 until 0.13.5
  ([astral-sh/uv#22750](https://github.com/astral-sh/uv/pull/22750) undoes
  [#22234](https://github.com/astral-sh/uv/pull/22234) for an export
  slowdown, and [#22751](https://github.com/astral-sh/uv/pull/22751) brings
  it back). An export can then include an optional dependency that is
  reached only through an incompatible platform path. In upstream's test for
  it, which the revert removed, `uv export --extra feature` also prints
  `leaf-c==1.0.0 ; sys_platform != 'linux'`, which uv before 0.13.3 left out.
  Both formats (requirements.txt and `pylock.toml`) have it. Since
  `sys_platform` is `wasi` in the kernel, installing such an export here
  installs that extra package too. `uv sync` doesn't use the export code and
  isn't affected. Workaround: delete the extra line from the export, or
  install the project with `uv sync`. It is fixed in 0.13.5.
  `cert/export.mjs` checks upstream's case: it expects the extra line since
  0.13.3 and until 0.13.5, and no extra line for any other version.

`uvx` (since 0.13.1-4, homescoop#771) is the same `uv.wasm` with `tool uvx`
in front, as upstream's `uvx` binary does: `uvx <command>` and
`uvx --from <package> <command>` run a package's command in a cached tool
environment, and `uvx --version` prints `uvx 0.13.4`. Only tools that are
pure Python (or have a `wasi_0_0_0_wasm32` build) run: ruff, for example,
ships native wheels and a Rust sdist only, so `uvx ruff` can't install it
(homescoop#1486).

Upstream is astral-sh/uv; homescoop's patches are in
[`packages/wasi-uv`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-uv).
