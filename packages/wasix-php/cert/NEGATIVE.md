# Negative proof (wasix-php 8.5.12-2)

**Date:** 2026-10-22

## 8.5.12-2: the published 8.5.12-1 fails the new specs

The published `@ai-ecoverse/wasix-php@8.5.12-1` against this tree's
`cert/` (slicc-kernel 1.145.0, users enforce):

- **openssl.cnf by default (#1690), `cert/openssl.mjs`:** with no
  settings, `openssl_pkey_new()` fails:

  ```text
  AssertionError [ERR_ASSERTION]: php rc=1
  stdout=nokey|error:8000002C:system library::No such file or directory|error:10000080:BIO routines::no such file|error:07000072:configuration file routines::no such file
  ```

  With the key rows skipped, `getenv("OPENSSL_CONF")` is empty
  (`'|missing|/etc/ssl/cert.pem'`).
- **the stack limit (#1689), `cert/stack.mjs`:** the issue's `php -r` of a
  5000-deep `serialize()` ends `php` with rc 70:

  ```text
  AssertionError [ERR_ASSERTION]: RangeError: Maximum call stack size exceeded
      at php.php_var_serialize_intern (wasm://wasm/php-0886f0aa:wasm-function[8587]:0x675ad9)
      at php.php_var_serialize_nested_data (wasm://wasm/php-0886f0aa:wasm-function[8595]:0x67ad1f)
  ```

  and `ini_get("zend.max_allowed_stack_size")` is false (the check isn't
  built). In 8.5.12-1, 500 levels of `serialize()`, `==` and `array_map()`
  recursion worked and 1000 ended in the same RangeError.
- `cert/licence.mjs` wants `patches/0009-zend-call-stack-wasi.patch`.

### Without parts of patches/0009

Measured on builds of this tree (the deepest level V8 allows is the same
in every build; the budget is the `-d zend.max_allowed_stack_size` at
which a recursion without end still throws PHP's Error and not a
RangeError):

- **Without the stack check** (8.5.12-1's configure, no
  `php_cv_have_stack_limit=yes`): no Error, every path below ends in the
  RangeError. V8 allows 331 levels of `usort()` calling itself, 652 of
  `__get()`, 628 of `__toString()`, 798 of `array_map()`, 939 of `==`,
  956 of `serialize()` and 1126 of `json_encode()`.
- **Without the 2 KiB frame** (`ZEND_WASI_CALL_STACK_FRAME`): the budget
  a path survives is 94 to 102 KiB for `==`, 125 to 133 for `usort()`, 196
  to 204 for `array_map()`, 227 to 235 for `__get()`, 852 to 860 for
  `__toString()` and 1180 to 1188 for `serialize()`. No size fits them
  all: 448 KiB leaves `==`, `usort()`, `array_map()` and `__get()` to the
  RangeError, and 80 KiB (under `==`'s) stops `__toString()` after 14
  levels and `serialize()` after about 16. A 1 KiB `volatile char` frame
  written at [0] did nothing (clang's SROA shrank it to one byte; 98 to
  113 KiB for `==`), so the frame is passed to an empty `asm` statement.
- **With it**, the budgets are 790 to 798 KiB for `usort()`, 1540 to 1548
  for `__get()`, 1860 to 1867 for `array_map()`, 1977 to 1985 for `==`,
  and over 2048 for `__toString()` and `array_walk_recursive()`, so 448
  KiB is about half of `usort()`'s and a quarter or less of the others'.
  The depths it allows: 94 levels of `==` on objects, 117 of
  `__toString()`, 124 of `json_encode()`, 167 of `__get()`, 174 of
  `usort()`, 177 of `array_map()`, 181 of `serialize()` and 188 of `==`
  on arrays.

- **The frame check in build.sh:** after `wasm-opt`, build.sh reads
  php.wasm's name section and fails unless `execute_ex`,
  `zend_hash_compare`, `zend_std_compare_objects` and
  `php_var_serialize_intern` each subtract at least 2048 from
  `__stack_pointer` (a later LLVM that dropped the frame would leave the
  check counting bytes again). On this build it prints
  `php.wasm: patches/0009's 2 KiB stack check frame in execute_ex 2048, zend_hash_compare 2048, zend_std_compare_objects 2064, php_var_serialize_intern 2128`.
  On 8.5.12-1's php.wasm, built without patches/0009, it fails:

  ```text
  homescoop wasix-php: execute_ex takes 0 bytes of shadow stack, not patches/0009's 2048-byte ZEND_WASI_CALL_STACK_FRAME, so the stack check no longer counts its levels
  ```

  (8.5.12-1's `zend_hash_compare` and `execute_ex` have no shadow frame,
  and `php_var_serialize_intern`'s is 1168 bytes.)

prove-negative on the 8.5.12-2 build:
`prove-negative: emptied 1 module(s): bin/php.wasm`, then
`prove-negative: ok — cert failed on bad wasix-php tarball (status 1; 15 of 18 spec(s) failed: bailout.mjs, checklist.mjs, fd.mjs, fibers.mjs, heap.mjs, http.mjs, memory.mjs, openssl.mjs, process.mjs, server.mjs, sqlite.mjs, stack.mjs, tmp-phar.mjs, users.mjs, xml.mjs)`.

## 8.5.12-1 (a new package)

A new package, so each patch's negative is the build or the cert case
without it, recorded while the recipe was written (PHP 8.5.12,
wasix-sysroot 2025.9.30-43, slicc-kernel 1.144.1 with users enforce).

### Without a patch

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

### Cert cases that failed on the way (fixed in the specs, not the build)

- The http wrapper's `$http_response_header` is deprecated in 8.5 (the
  specs use `http_get_last_response_headers()`), and so are backticks.
- `openssl_pkey_new()` fails without an OpenSSL config file, which slicc
  doesn't have (`configuration file routines::no such file`); 8.5.12-1's
  checklist asserted that and passed one through `config` and
  `OPENSSL_CONF` (8.5.12-2 ships one, `cert/openssl.mjs`).
- A descriptor bash opens for a WASI program at fd 3 to 11 is shadowed by
  the kernel's preopened directories (`Is a directory`), so `cert/fd.mjs`
  checks fds 1, 2 and the error paths only.

### prove-negative

`node scripts/browser-cert/prove-negative.mjs --package wasix-php --tarball <8.5.12-1 package.tgz>`
(slicc-kernel 1.144.1): `prove-negative: emptied 1 module(s): bin/php.wasm`,
then `prove-negative: ok — cert failed on bad wasix-php tarball (status 1; 13 of 16 spec(s) failed: bailout.mjs, checklist.mjs, fd.mjs, fibers.mjs, heap.mjs, http.mjs, memory.mjs, process.mjs, server.mjs, sqlite.mjs, tmp-phar.mjs, users.mjs, xml.mjs)`.
licence.mjs, notices.mjs and the package's file checks don't run php.
