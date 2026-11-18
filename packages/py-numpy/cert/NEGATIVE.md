# Negative proof (py-numpy, cp315 line)

## python-range.mjs: 2.5.4-4 nests a second python under a later 3.15 patch release (2.5.4-5; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-numpy@2.5.4-4` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-numpy/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 2.5.4-5's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## 2.5.4-3: numpy-config and f2py are not on PATH (2.5.4-4; #1405; 2026-10-21)

`cert/commands.mjs` on npm 2.5.4-3 (wasix-python 3.15.0-3, slicc-kernel 1.142.0, `--users enforce`, Node entry): FAIL `numpy-config --version: rc=127 stdout= stderr=numpy-config: command not found`. 2.5.4-3 has no `slicc.commands` and no `bin/`. The same tarball with 2.5.4-4's `package.json` and the `bin/` launchers `build.sh` now writes passes: `numpy-config --version` 2.5.4, `--cflags -I/node_modules/@ai-ecoverse/py-numpy/lib/python3.15/site-packages/numpy/_core/include`, `f2py -v` 2.5.4.

## 2.5.4-2: five entry points trap, a stale config record (2.5.4-3; #1083, #1088; 2026-10-20)

On npm 2.5.4-2 (wasix-python 3.15.0-3, slicc-kernel 1.125.0, Node entry):
- `cert/signatures.mjs`: FAIL `scalar_input: rc=134 python3: wasm trap: function signature mismatch` (each of the seven cases traps the same way, among them the public `copy.copy(np.float64(1.5))` and `a.dtype = np.int64`; `wasm-call-signatures.mjs` lists them in the build log).
- `cert/numpy.mjs`: FAIL on `config_prefix_map` (`show_config()` records `-ffile-prefix-map=.=.`).
2.5.4-3 passes both.

## 2.5.4-1: the first cp315 numpy (homescoop#761; 2026-10-18)

`cert/import.mjs` with wasix-python 3.15.0-1 and npm's cp314 py-numpy 2.3.2-12 instead of this tarball (slicc-kernel 1.125.0, Node entry): FAIL, `py-numpy brings no python of its own`. 2.3.2-12 declares `@ai-ecoverse/wasix-python >=3.14.2-27 <3.14.3`, so npm nests a second, 3.14 python under it. Its 19 side modules are `*.cpython-314-wasm32-wasix.so`, which python 3.15 (EXT_SUFFIX `.cpython-315-wasm32-wasix.so`) doesn't import. 2.5.4-1 passes import, numpy, patches and linalg-errors on 3.15.0-1.
