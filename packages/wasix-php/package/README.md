# @ai-ecoverse/wasix-php

PHP 8.5 for slicc WASIX: the `php` command line, with `php -S`, the built-in web server.

- Built on wasix-sysroot 2025.9.30-43 (the asyncify tree, for real fork)
- Cross-built with PHP's own configure and wasixcc, then `wasm-opt --asyncify`
- Extensions: bcmath, calendar, ctype, date, dom, exif, fileinfo, filter, hash, iconv, json, lexbor, libxml, mbstring, openssl, pcntl, pcre, PDO, pdo_sqlite, Phar, posix, random, Reflection, session, SimpleXML, SPL, sqlite3, standard, tokenizer, uri, xml, xmlreader, xmlwriter, Zend OPcache and zlib, all statically linked
- `pcntl_fork`, `proc_open`, `exec`, `system` and backticks work (WASIX `proc_fork` and `posix_spawn`), and so do `pcntl_signal` handlers, `pcntl_alarm` and `posix_kill`
- `http://` and `https://` streams (`file_get_contents`, `fopen`) go through the proxy in `http_proxy`/`https_proxy` when the stream context sets none, and skip it for `no_proxy` hosts, as curl does; slicc-kernel sets these to its own proxy, and its CA in `SSL_CERT_FILE`, so https needs no settings (`patches/0007`)
- `max_execution_time` and `set_time_limit()` count wall-clock time, as on macOS on Apple Silicon: WASIX has no CPU-time timer, so the limit is an `ITIMER_REAL` that also counts `sleep()`, and it shares `SIGALRM` with `pcntl_alarm()` (`patches/0008`)
- The memory manager takes its 2 MiB chunks from a pool of aligned arenas (`patches/0004`), so the wasm memory stays close to `memory_get_usage(true)`
- `openssl_pkey_new()` and `openssl_csr_new()` read OpenSSL's config file, and slicc has no `/etc/ssl/openssl.cnf`: without one they fail (`configuration file routines::no such file`), as upstream does. Point `OPENSSL_CONF` or the `config` option at any file, even an empty one
- `php.ini` is read from `/etc/php`, and further `.ini` files from `/etc/php/conf.d`; none is shipped, so PHP's defaults apply (`memory_limit` 128M)

## Not available

- **Fibers:** a wasm call stack can't be switched, so `Fiber::start()` throws a `FiberError` (`patches/0002`). Code that uses Fibers (Revolt, AMPHP v3) doesn't run; code that only checks for the class does.
- **`php -a`:** the interactive shell needs the readline extension, which isn't built.
- **Extensions:** sockets (WASIX has no ancillary data and no interface ioctls), curl, gd, intl, sodium, zip, ffi, and loading extensions with `dl()`.
- **OPcache** is built in but has no shared memory here, so it caches nothing (`opcache.enable_cli` stays off).
- **Deep recursion inside C:** encoding or comparing a structure nested thousands of levels deep (`json_encode` with a raised depth, `serialize`) can exhaust the browser's native stack, which ends `php` with `RangeError: Maximum call stack size exceeded`. PHP function calls themselves don't use it.

## Source

PHP 8.5.12 from php.net, with the patches in `patches/` (their headers say why), plus libxml2 and SQLite, which this recipe builds; `SOURCES.md` lists every source and its sha256.
