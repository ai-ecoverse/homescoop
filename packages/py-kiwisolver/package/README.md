# `@ai-ecoverse/py-kiwisolver`

kiwisolver 1.5.1 for slicc WASIX CPython 3.14 (`cpython-314-wasm32-wasix`).

`kiwisolver/_cext.cpython-314-wasm32-wasix.so` is a `dylink.0` side module
that `python.wasm` loads by `dlopen`. It is built from the PyPI sdist in
homescoop's CI (`build.sh`): wasixcc++ with legacy wasm exceptions and PIC,
against `@ai-ecoverse/wasix-python` 3.14.2-27's headers and the libc++
headers of the C++ runtime that `python.wasm` exports (wasix-libc
v2026-07-03.1 `sysroot-ehpic`; see wasix-python's README, "Side modules").

## Since 1.5.1-9

- **The build:** built again from the sdist, against wasix-python 3.14.2-27's headers, with the pinned wasixcc on wasix-sysroot 2025.9.30-34 (the sysroot line CI-built from public sources, homescoop#890).
- **Dependency:** `@ai-ecoverse/wasix-python` `>=3.14.2-27 <3.14.3`.
- **Up to -8:** -8 was a packaging-only repack of -7, which was built against 3.14.2-16 (an expired input).

## Since 1.5.1-7

- **No-argument methods and the strength getters work.** wasm checks a
  function pointer's exact signature, and CPython calls a `METH_NOARGS`
  method as `f(self, NULL)` and a getter as `get(self, closure)`. kiwisolver
  defines them with one parameter, which native ABIs tolerate. Up to
  1.5.1-6, `Variable.value()`, `Solver.updateVariables()`, `strength.strong`
  and the other 18 such calls ended python with
  `wasm trap: function signature mismatch` (exit 134), and so did
  matplotlib's constrained layout (`layout="constrained"`), which uses them
  (homescoop#197). `kiwisolver-wasm-call-signatures.patch` adds the unused
  second parameter.
- `test/wasm-call-signatures.mjs` reads the side module's method and getset
  tables and fails the build if a function's arity differs from the call
  CPython makes.
- Built in CI from source. Up to 1.5.1-6 the package carried a side module
  built outside homescoop.
