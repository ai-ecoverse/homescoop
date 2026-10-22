# Negative proof (wasix-php 8.5.12-1)

**Date:** 2026-10-22

A new package, so each patch's negative is the build or the cert case
without it, recorded while the recipe was written (PHP 8.5.12,
wasix-sysroot 2025.9.30-43, slicc-kernel 1.144.1 with users enforce).

## Without a patch

- **patches/0001 (configure for a wasi host):** PHP's own configure stops:

  ```text
  checking for ucontext.h... no
  configure: error: in `/tmp/php-wasix/neg/php-8.5.12':
  configure: error: fibers not available on this platform
  ```

  An earlier build without the PHP_OS hunk reported `PHP_OS` `Darwin`, the
  build machine's `uname` (`cert/checklist.mjs` wants `WASI`).
- **patches/0002 (fibers unavailable):** with configure's
  `ZEND_FIBER_UNAVAILABLE` but upstream's `zend_fibers.c`, the link fails:

  ```text
  wasm-ld: error: Zend/zend_fibers.o: undefined symbol: madvise
  wasm-ld: error: Zend/zend_fibers.o: undefined symbol: mprotect
  wasm-ld: error: Zend/zend_fibers.o: undefined symbol: make_fcontext
  wasm-ld: error: Zend/zend_fibers.o: undefined symbol: jump_fcontext
  ```
- **patches/0003 (setjmp):** `ext/iconv` doesn't compile (the asyncify
  sysroot's `<setjmp.h>` declares no `sigsetjmp`; every `zend_try` is
  `SETJMP`):

  ```text
  ext/iconv/iconv.c:468:2: error: call to undeclared library function 'sigsetjmp' with type 'int (__wasi_stack_snapshot_t *, int)'
  ```
- **patches/0004 (Zend MM chunks):** upstream's `zend_alloc.c` doesn't link
  (`wasm-ld: error: Zend/zend_alloc.o: undefined symbol: madvise`, its
  MADV_HUGEPAGE path), and its trim-to-alignment needs partial `munmap`s,
  which wasi-libc's emulation refuses with EINVAL. The first version of the
  patch took each chunk from `posix_memalign` and paid the alignment slack
  per chunk: `cert/heap.mjs`'s 400000-entry array, at
  `memory_get_usage(true)` 120 MiB, grew the wasm memory to 252 MiB
  (VmSize 258112 kB; 163 MiB with `USE_ZEND_ALLOC=0`). With the arena pool,
  162 MiB (165952 kB).
- **patches/0005 (P_tmpdir):** `sys_get_temp_dir()` returned `''` with no
  `TMPDIR`, `tempnam("", "x")` and `tmpfile()` returned false, and Phar
  failed:

  ```text
  Fatal error: Uncaught BadMethodCallException: Entry index.php does not exist and cannot be created: phar error: unable to create temporary file
  ```
- **patches/0006 (php://fd):** `ext/standard/php_fopen_wrapper.c:321:16:
  error: call to undeclared function 'getdtablesize'`.
- **patches/0007 (environment proxy):** every remote URL failed, http and
  https alike, while the kernel's `http_proxy`/`https_proxy` were set:

  ```text
  Warning: file_get_contents(http://example.test/hello): Failed to open stream: php_network_getaddresses: getaddrinfo for example.test failed: Name does not resolve
  ```
- **patches/0008 (max_execution_time):** `cert/bailout.mjs`'s
  `set_time_limit(1)` never fired: the 10-second busy loop printed
  `no timeout` and php exited 0 (`setitimer(ITIMER_PROF)` is EINVAL on
  WASIX).

## Cert cases that failed on the way (fixed in the specs, not the build)

- The http wrapper's `$http_response_header` is deprecated in 8.5 (the
  specs use `http_get_last_response_headers()`), and so are backticks.
- `openssl_pkey_new()` fails without an OpenSSL config file, which slicc
  doesn't have (`configuration file routines::no such file`); the checklist
  asserts that and passes one through `config` and `OPENSSL_CONF`.
- A descriptor bash opens for a WASI program at fd 3 to 11 is shadowed by
  the kernel's preopened directories (`Is a directory`), so `cert/fd.mjs`
  checks fds 1, 2 and the error paths only.

## prove-negative

`node scripts/browser-cert/prove-negative.mjs --package wasix-php --tarball <8.5.12-1 package.tgz>`
(slicc-kernel 1.144.1): `prove-negative: emptied 1 module(s): bin/php.wasm`,
then `prove-negative: ok — cert failed on bad wasix-php tarball (status 1; 13 of 16 spec(s) failed: bailout.mjs, checklist.mjs, fd.mjs, fibers.mjs, heap.mjs, http.mjs, memory.mjs, process.mjs, server.mjs, sqlite.mjs, tmp-phar.mjs, users.mjs, xml.mjs)`.
licence.mjs, notices.mjs and the package's file checks don't run php.
