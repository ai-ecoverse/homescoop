
## 3.14.2-15 `_ctypes` on slicc-kernel 1.49.0 (no POSIX `dlopen(NULL)`)

On 1.49.0, `wasix_32v1.dlopen` with a NULL path returns handle **0** (main).
POSIX/`ctypes` treat that as failure, so `ctypes/__init__.py`'s
`pythonapi = PyDLL(None)` makes **`import ctypes` itself** raise `OSError`.
`import _ctypes` and `CDLL("/path/to/side.so")` work; `CFUNCTYPE` still hits
`closure_prepare` ENOSYS (exit 134).

A homescoop remap of `dlopen(None)` → `bin/python.wasm` was tried and
**rejected**: the kernel's `load()` does not put the main module in `byPath`,
so that path loads a **second** PIE CPython (`Py_IsInitialized()` would be 0).
Fix belongs in the kernel (non-zero main handle) or a tiny `__wasi__`
`py_dl_open` NULL→0 handling — not `_slicc_site`. Cert waits on that + step 2.

# Negative proof (wasix-python 3.14.2-10 / -11 venvs)

## 3.14.2-11 (homescoop#157), slicc-kernel 1.30.0's Node entry

- **3.14.2-10** fails the chained-sitecustomize case: `import sitecustomize`
  returns ours, not the user's (#157 b).
  ```
  + '1 /node_modules/@ai-ecoverse/wasix-python/lib/python3.14/sitecustomize.py\n'
  - '1 /home/v/lib/python3.14/site-packages/sitecustomize.py\n'
  ```
- **-11 without `site-packages/slicc-executable.pth`**: a sitecustomize on
  PYTHONPATH shadows the stdlib one and sys.executable stays '' (#157 c).
  ```
  + ' 1\n'
  - '/usr/bin/python 1\n'
  ```
- **-11 without `os.path.abspath`** in `_slicc_site.py`: `PATH=.` in
  /usr/bin gives a relative executable (#157 a).
  ```
  + './python\n'
  - '/usr/bin/python\n'
  ```

**Date:** 2026-10-09
Not in `scripts/ci-certified.json`; venv support needs human cert.

## 3.14.2-9 (no sitecustomize.py)

On a kernel with the slicc-kernel#168 prototype, the first case fails:

```
+ '  True\n'
- '/usr/bin/python /usr/bin/python True\n'
```

## Kernel without slicc-kernel#168

-10 on stock slicc-kernel 1.26.4: the venv's python starts with argv[0]
`python`, so it runs as the base interpreter:

```
+ '/node_modules/@ai-ecoverse/wasix-python/ /usr/bin/python False\n'
- '/home/v /home/v/bin/python True\n'
```

## Spec non-vacuous

Exact sys.prefix/sys.executable strings for base and venv, where pip put
requests (venv site-packages, not the user site, not the base), a console
script and a subprocess inside the venv, and a chained user sitecustomize.
