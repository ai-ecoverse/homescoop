# Negative proof (uv-shim)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty script

With `bin/uv` truncated to 0 bytes (slicc-kernel 1.26.4, Node entry):

```
uv --version: rc=127
stderr=bash: line 1: /usr/bin/uv: cannot execute: required file not found
```

## Venv not activated

With the line that sets `PYTHONEXECUTABLE=<venv>/bin/python` removed from
`venv_env()`, pip runs as the base interpreter and installs into it, and the
done-when case fails:

```
+ '2.34.2 /node_modules/@ai-ecoverse/wasix-python/'
- '2.34.2 /home/u/.venv'
```

## Spec non-vacuous

`cert/checklist.mjs` checks `sys.prefix` of `uv run`, that base python
cannot import what `uv pip install` put in the venv, the exact
`dependencies` array `uv add` writes, pip list/freeze versions, that
`uv remove` and `uv pip uninstall` really uninstall, and exit code 2 with
the shim's message for missing venvs/projects and unsupported commands.
