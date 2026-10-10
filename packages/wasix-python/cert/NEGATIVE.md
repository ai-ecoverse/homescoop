
## 3.14.2-15 `_ctypes` / ImportError→OSError (homescoop#110)

**-15 on a kernel without the dlopen(NULL)=main fix (e.g. 1.49.0):**
`import ctypes` raises OSError at ctypes/__init__.py:565
(`pythonapi = PyDLL(None)` → "dlopen() error"). numpy/_core/_internal.py
imports ctypes under `except ImportError`, so `import numpy` fails, and with
it every py-* package that imports numpy (pandas, scipy, matplotlib, …).
Measured in cert/sidemods.mjs, run 38088989164. **-14 is unaffected**
(ImportError, caught).

**Second example — huggingface_hub / `hf`:** **-15 on 1.49.0:** `import ctypes`
raises OSError (`dlopen(NULL)`); hf fails. **-14:** hf fails with
`ModuleNotFoundError` (no `_ctypes`; huggingface_hub 2.2.0's `_terminal.py`
does a bare top-level `import ctypes`).

**-15 is not published** before the kernel with r99's fix + #306 step 2;
`engines` and `cert/meta.json` `kernel` name that release. npm/pnpm treat
`engines` as advisory, so the coordinator will have seven move python to -15
in the catalog only in the same PR as the kernel bump.
`cert/sidemods.mjs` passing on the fixed kernel gates the py-* re-pin wave.

A homescoop remap of `dlopen(None)` → `bin/python.wasm` was tried and
**rejected** (second PIE load; `Py_IsInitialized` would be 0). Not `_slicc_site`.

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
