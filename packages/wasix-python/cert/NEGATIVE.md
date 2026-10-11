

## 3.14.2-15: ctypes cannot call variadic functions

wasix-org/libffi's WASIX backend returned `FFI_BAD_ABI` from `ffi_prep_cif_machdep_var`, so with `argtypes` naming the fixed parameters every variadic call (`printf`, `snprintf`, `sscanf`, `open(…, mode)`, `fcntl`, `ioctl`) raised `ffi_prep_cif_var failed` (hb2's cert-python-3.14.2-15 probes). Without `argtypes`, ctypes passes every argument as fixed, which on wasm32 is a different call signature than the variadic function has. 3.14.2-16 fixes the first case (`patches/libffi-wasix-varargs.patch`, `cert/ctypes-varargs.mjs`); the second stays wrong by the ABI, as on Apple arm64.

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

**Floor:** slicc-kernel **1.51.0** (`engines` `>=1.51.0`, `cert/meta.json`
`kernel` `@ai-ecoverse/slicc-kernel@1.51.0`) — r99's #316 (`dlopen(NULL)` /
own path / symlink = main + `closure_prepare`). npm/pnpm treat `engines` as
advisory, so the catalog moves python to -15 with the kernel bump.
`cert/sidemods.mjs` on ≥1.51.0 gates the py-* re-pin wave.

A homescoop remap of `dlopen(None)` → `bin/python.wasm` was tried and
**rejected** (second PIE load; `Py_IsInitialized` would be 0). Not `_slicc_site`.

## 3.14.2-15 py-* discovery (no PYTHONPATH)

- **3.14.2-14** finds no py-* package by itself: `import numpy` is
  `ModuleNotFoundError` unless `PYTHONPATH` lists every `site-packages`
  (cert/sidemods.mjs set it until -15). With pnpm 12, even that is hard:
  `pnpm add -g a b` makes one global project per package, and the
  transitive py-* (py-numpy under py-pandas, …) are only in each project's
  `.pnpm` store.
- **Not picked up, by design** (cert/discovery.mjs checks the first):
  a py-* whose `wasix-python` (Node's lookup from its real directory) is
  another version, e.g. one built for 3.14.2-13 next to a 3.14.2-15 python
  (`python -v`: "skip …: built for wasix-python 3.14.2-13, this is
  3.14.2-15"); a py-* whose `requires` abi/platform differ; a py-* in
  another (non-pnpm-global) project; a second copy of a name already found.
  Packages in a venv without `--system-site-packages` are not added.
- `.pth` files inside a py-* `site-packages` are not run (as with
  `PYTHONPATH`); no published py-* has one.
- **The re-pin wave must ship with -15.** Published py-* that pin
  wasix-python exactly (py-numpy 2.3.2-7: `3.14.2-13`) bring their own
  nested copy; next to a 3.14.2-15 python, discovery refuses them by design
  (browser cert run 38092730025: "skip @ai-ecoverse/py-numpy 2.3.2-7: built
  for wasix-python 3.14.2-13, this is 3.14.2-15", and numpy was not
  importable without PYTHONPATH). Caret-ranged older py-* resolve to the
  top-level python and are taken. cert/discovery.mjs asserts that refusal,
  then re-pins (fixtures/repin.mjs) for the rest of the cert.
- 5ae7f67d's discover() shadowed its JSON scanner with `_scan()` and
  parsed every package.json through `json.loads` after an exception (works,
  but imports json/re at startup); its cache did not cover the pythons the
  py-* resolved to (a moved nested copy kept a stale refusal). Both fixed.

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
