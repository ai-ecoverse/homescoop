# @ai-ecoverse/wasix-php

PHP 8.5 for slicc WASIX: the `php` command line, with `php -S`, the built-in web server.

- Built on wasix-sysroot 2025.9.30-43 (the asyncify tree, for real fork)
- Cross-built with PHP's own configure and wasixcc, then `wasm-opt --asyncify`
- Extensions: bcmath, calendar, ctype, date, dom, exif, fileinfo, filter, hash, iconv, json, lexbor, libxml, mbstring, openssl, pcntl, pcre, PDO, pdo_sqlite, Phar, posix, random, Reflection, session, SimpleXML, SPL, sqlite3, standard, tokenizer, uri, xml, xmlreader, xmlwriter, Zend OPcache and zlib, all statically linked
- `pcntl_fork`, `proc_open`, `exec`, `system` and backticks work (WASIX `proc_fork` and `posix_spawn`), and so do `pcntl_signal` handlers, `pcntl_alarm` and `posix_kill`
- `http://` and `https://` streams (`file_get_contents`, `fopen`) go through the proxy in `http_proxy`/`https_proxy` when the stream context sets none, and skip it for `no_proxy` hosts, as curl does; slicc-kernel sets these to its own proxy, and its CA in `SSL_CERT_FILE`, so https needs no settings (`patches/0007`)
- `max_execution_time` and `set_time_limit()` count wall-clock time, as on macOS on Apple Silicon: WASIX has no CPU-time timer, so the limit is an `ITIMER_REAL` that also counts `sleep()`, and it shares `SIGALRM` with `pcntl_alarm()` (`patches/0008`)
- The memory manager takes its 2 MiB chunks from a pool of aligned arenas (`patches/0004`), so the wasm memory stays close to `memory_get_usage(true)`
- `openssl_pkey_new()`, `openssl_csr_new()` and `openssl_csr_sign()` work with no settings. They read OpenSSL's config file, and slicc has no `/etc/ssl/openssl.cnf`, so the `php` command sets `OPENSSL_CONF` to the package's `etc/openssl.cnf`. That file has a `[ req ]` section with `default_bits = 2048` (the size of an RSA key when no `private_key_bits` is given), `default_md = sha256` (the signature digest) and an empty `distinguished_name` section, which `openssl_csr_new()` requires. An `OPENSSL_CONF` you set yourself wins, and so does the `config` option
- Recursion in C stops with PHP's own `Error: Maximum call stack size of 409600 bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?`, which a script can catch, instead of overflowing the browser's native stack (`patches/0009`). Recursion in C includes `serialize()`, `json_encode()` and `==` on nested data, and PHP functions that call themselves through `array_map()`, `usort()`, `preg_replace_callback()`, `__get()`, `__toString()` or `ArrayAccess`. It is about 180 levels of `serialize()`, `array_map()`, `usort()` or `__get()`, 120 of `__toString()` and `json_encode()` (which returns false with `Maximum stack depth exceeded`), and 90 to 190 of `==` on objects and arrays (`Maximum call stack size reached during comparison`). The budget is wasm's shadow stack, where every frame that runs the check counts at least 2 KiB, about what it costs the browser's stack. PHP functions calling each other directly don't count, since PHP keeps their frames in its own memory (50000 levels work). `-d zend.max_allowed_stack_size=<bytes>` sets a different budget, and `-1` turns the check off
- `php.ini` is read from `/etc/php`, and further `.ini` files from `/etc/php/conf.d`; none is shipped, so PHP's defaults apply (`memory_limit` 128M)

## Not available

- **Fibers:** a wasm call stack can't be switched, so `Fiber::start()` throws a `FiberError` (`patches/0002`). Code that uses Fibers (Revolt, AMPHP v3) doesn't run; code that only checks for the class does.
- **`php -a`:** the interactive shell needs the readline extension, which isn't built.
- **Extensions:** sockets (WASIX has no ancillary data and no interface ioctls), curl, gd, intl, sodium, zip, ffi, and loading extensions with `dl()`.
- **OPcache** is built in but has no shared memory here, so it caches nothing (`opcache.enable_cli` stays off).
- **Deep recursion inside C without PHP's check:** a few paths have no stack check in PHP itself, and still end `php` with `RangeError: Maximum call stack size exceeded` when the browser's native stack runs out. They are `print_r()` past about 1100 levels of nesting, `var_export()` past about 1500, `unserialize()` past about 1850 (its own `unserialize_max_depth` is 4096), and freeing an array nested more than about 3000 levels deep.

## Source

PHP 8.5.12 from php.net, with the patches in `patches/` (their headers say why), plus libxml2 and SQLite, which this recipe builds; `SOURCES.md` lists every source and its sha256.
