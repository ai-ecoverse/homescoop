# `@ai-ecoverse/wasix-uv-shim`

A small `uv` for [slicc](https://github.com/ai-ecoverse/slicc): uv's everyday
commands mapped onto `python -m venv` and the pip in
[`@ai-ecoverse/wasix-python`](https://www.npmjs.com/package/@ai-ecoverse/wasix-python).
**It is not Astral's uv**, which does not build for WASI yet (see
[homescoop#103](https://github.com/ai-ecoverse/homescoop/issues/103)).

```bash
pnpm add -g @ai-ecoverse/wasix-uv-shim
uv venv && uv pip install requests && uv run python -c 'import requests'
uv init demo && cd demo && uv add httpx && uv run python main.py
```

| Command | Does |
| --- | --- |
| `uv venv [PATH] [--seed]` | `python -m venv --without-pip` (`--seed` adds pip) |
| `uv pip install\|uninstall\|list\|freeze\|show\|check` | pip in `$VIRTUAL_ENV` or the nearest `.venv` (`--system`: the base interpreter) |
| `uv run CMD…` | syncs the project, then runs `python`, a `.py` file, a venv console script or any command with the venv active |
| `uv add [--dev] PKG…` / `uv remove` | edit `[project] dependencies` (`[dependency-groups] dev`), then sync; bare names get `>=installed` |
| `uv sync` | install the project's dependencies (and the project itself, editable, if it has a `[build-system]`) |
| `uv init [PATH]` | a minimal `pyproject.toml` and `main.py` |

No lock files, `uv tool`, Python installs, builds or `uv pip compile`;
those exit 2. `uv --version` prints the shim's version. Compiled packages
come from homescoop's `@ai-ecoverse/py-*` npm packages, not wheels.

A venv's python is wasix-python told where it lives: the shim runs the base
`python3` with `PYTHONEXECUTABLE=<venv>/bin/python`, which `site.venv()`
honours.

Certified on `@ai-ecoverse/slicc-kernel` 1.26.4 with wasix-python 3.14.2-9.
