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
```

PyPI is reached through the kernel's proxy (`HTTPS_PROXY`, CA in
`SSL_CERT_FILE`, both set by the kernel). Checked in the kernel: `uv venv`,
`uv pip install|list|uninstall`, `uv init`, `uv add`, `uv remove`,
`uv lock`, `uv sync`, `uv tree`, `uv run` (python, modules, console
scripts), sdist builds (PEP 517, e.g. setuptools) and `--compile-bytecode`.

Limits in seven:

- **Wheels:** the interpreter's platform tag is `wasi_0_0_0_wasm32`, which
  PyPI has no wheels for. Pure-Python wheels and sdists install; compiled
  packages come from homescoop's `@ai-ecoverse/py-*` npm packages.
- **No git dependencies** (uv spawns git through code that cannot spawn on
  WASI yet), no `uv python install`, no `uv self update`.
- **No file locks:** two uv processes on one cache or environment at the
  same time are not serialised.
- Files are copied from the cache into environments (`UV_LINK_MODE=copy`,
  set by the command).

Upstream is astral-sh/uv; homescoop's patches are in
[`packages/wasi-uv`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-uv).
