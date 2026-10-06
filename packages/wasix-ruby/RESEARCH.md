# wasix-ruby research (before full build)

Target: Ruby 3.4 on WASIX (wasixcc + wasix-sysroot asyncify), like wasix-python/perl — not ruby.wasm wasip1.

## Fiber / setjmp

- **ruby.wasm (wasip1)** uses Binaryen **asyncify** for Fiber + setjmp/longjmp.
- **WASIX** provides `wasix_32v1.stack_checkpoint` / `stack_restore` (real setjmp story in wasix-libc).
- **Implication:** Fiber can use WASIX setjmp *if* Ruby’s coroutine path is wired to libc setjmp, **or** we still need asyncify on the final `ruby.wasm` when Fiber parks across host calls (I/O). Plan: build with WASIX setjmp first; add asyncify (full, **with** indirect — same lesson as Perl `pp_*`) if Fiber/eval unwind traps.
- Do **not** use `asyncify-ignore-indirect` for MRI (VM dispatch is indirect).

## Likely blockers

1. **Configure probes** — same as perl-cross: force feature tests; cannot run target binaries during configure.
2. **Process** — need fork/exec/pipe for `system` / backticks / `IO.popen` (WASIX asyncify sysroot).
3. **C extensions** — json, psych+libyaml, zlib, stringio, strscan, date, digest, socket: static link preferred.
4. **OpenSSL** — link if wasix TLS story exists (wasix-python path); else skip and document.
5. **RubyGems + Bundler** — ship with default gems; site dir under package + user local.

## Build shape

- Mirror wasix-python: wasixcc, `WASIXCC_WASM_EXCEPTIONS=no`, PIC off, post-link wasm-opt `--asyncify`.
- Acceptance: scripts (no irb required), `gem list`, `bundle exec rake` on tiny project, system/backticks.

## Cross-configure gotchas (3.4.11 / wasixcc 0.4.7)

- Need Homebrew (or other ≥3.x) **baseruby**; macOS `/usr/bin/ruby` 2.6 is rejected.
- `--build` must be a real triple (`aarch64-apple-darwinNN`); empty/unknown from `clang -dumpmachine` breaks `config.sub`.
- Use `--with-thread=pthread` (default wasi probe picks `none`, which breaks `HAVE_WORKING_FORK` + `thread_sched_atfork`).
- Force in `config.site` / post-config `config.h`:
  - `rb_cv_gcc_atomic_builtins=yes` (configure link probe fails; clang has `__atomic_*`)
  - `rb_cv_function_name_string=__func__` (else `RUBY_FUNCTION_NAME_STRING` missing)
  - `ac_cv_func_clock_getres=yes` / `HAVE_CLOCK_GETRES`
  - `HAVE_LSTAT`, `HAVE_MEMRCHR`, `HAVE_POLL`, `HAVE_SIGACTION`, `POSIX_SIGNAL`
- Upstream already ships `wasm/setjmp*.S` — useful for Fiber once link succeeds.
- Heavy `make -j$(ncpu)` can SIGKILL (OOM) around `builtin.c` / wasm asm; prefer `-j4`.
- Encodings default to shared (`CCDLFLAGS=-fPIC` + `.so` link) — use `--with-static-linked-ext` and strip `-fPIC` from `enc.mk` / `rbconfig.rb` (wasixcc rejects PIC without exceptions).
