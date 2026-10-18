# `@ai-ecoverse/py-kiwisolver` (cp315)

kiwisolver 1.5.1 for slicc WASIX CPython 3.15 (`cpython-315-wasm32-wasix`). During the Python 3.15 wave (homescoop#761) it's published under the npm dist-tag `python3.15`; `latest` stays on the cp314 line until the flip.

`kiwisolver/_cext.cpython-315-wasm32-wasix.so` is a `dylink.0` side module that `python.wasm` loads by `dlopen`.

- **Build:** in homescoop's CI from the PyPI sdist, with wasixcc++ (legacy wasm exceptions, PIC). It is built against `@ai-ecoverse/wasix-python` 3.15.0-1's headers and the libc++ headers of wasix-sysroot 2025.9.30-38's `sysroot-ehpic`, the C++ runtime that `python.wasm` exports.
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **Call signatures:** the no-argument methods and strength getters take CPython's second parameter (`kiwisolver-wasm-call-signatures.patch`, homescoop#588).
