# Negative proof (wasi-hf)

**Date:** 2026-10-09 (0.1.0-1; 0.1.0-2 adds the token file mode)
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

`cert/checklist.mjs` was run on slicc-kernel 1.29.2's Node entry (1.30.0 for 0.1.0-2), with the
same transport traits and 16 KiB chunks as `scripts/browser-cert/page/page.js`.
The good build passes in about 2.5 s. Each build below was the good source with one
change, built with the same toolchain (Rust 1.98.1, wasm32-wasip1-threads).

## Empty wasm (spec not vacuous)

`bin/hf.wasm` truncated to 0 bytes, as `prove-negative.mjs` does:

```text
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## No Range on resume

With the `Range: bytes=<have>-` header never sent, the resume case fails. The
file still ends up byte-exact, because the tool starts again on a 200, but
the spec asserts the resume:

```text
AssertionError: manual: rc=0
hf: onnx/model.onnx: the server ignored the range; starting again
```

## No sha256 check

With the LFS sha256 check removed, a wrong `.incomplete` prefix is resumed
and kept:

```text
The input did not match the regular expression /sha256 mismatch; downloading it again from the start/
'hf: onnx/model.onnx: resuming at 97.7 KiB\n' + 'hf: downloaded onnx/model.onnx (293.0 KiB)\n'
```

## Relative paths against wasi-libc's cwd

With `PWD` ignored (Rust std's `current_dir()` stays `/` in the kernel), a
relative `--to` lands at the root:

```text
AssertionError: relative --to is not under the cwd
+ '/out-follow\n'
- '/home/proj/out-follow\n'
```

## Token file not private (0.1.0-2)

With `slicc.commands.hf.imports` removed from package.json, the kernel
answers `hf_host.chmod` with ENOSYS. hf warns, and the file keeps the
default mode:

```text
AssertionError: the token file is not private
'644\n' !== '600\n'
```
