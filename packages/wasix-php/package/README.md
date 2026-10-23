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
- Recursion in C stops with PHP's own `Error: Maximum call stack size of 2048000 bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?`, which a script can catch, instead of overflowing the browser's native stack (`patches/0009`). Recursion in C includes `serialize()`, `json_encode()` (which returns false with `Maximum stack depth exceeded`), `==` (`Maximum call stack size reached during comparison`), `var_dump()` (`nesting level too deep`) and compiling deeply nested code, and PHP functions that call themselves through `array_map()`, `usort()`, `preg_replace_callback()`, `__get()`, `__toString()`, `ArrayAccess` and other callbacks. PHP functions calling each other directly don't count, since PHP keeps their frames in its own memory (50000 levels work). See *How deep C recursion goes* below
- `php.ini` is read from `/etc/php`, and further `.ini` files from `/etc/php/conf.d`; none is shipped, so PHP's defaults apply (`memory_limit` 128M)

## How deep C recursion goes

What runs out first is the browser's native stack, where every wasm frame sits, but PHP's check can only measure wasm's shadow stack in linear memory, and the two disagree by path: most C frames take a few bytes of shadow stack or none. So `patches/0009` gives the C functions on each recursive path a fixed pad of shadow stack, sized from how deep the browser lets that path go, and the check's 2048000 bytes run out at about 65% of that depth. The other third is left for throwing the Error and for the difference between browsers and between V8's compilers (the depths below are the shallowest, with every function still in V8's baseline compiler).

8.5.12-2 gave every checked frame the same 2 KiB and a 400 KiB budget, which stopped every path after 90 to 190 levels (homescoop#1705). 8.5.12-1 had no check: each path went as deep as the browser allowed and then ended `php` with `RangeError: Maximum call stack size exceeded` (rc 70). 8.5.12-3 gets back the depths of homescoop#1689 and #1705 (500 levels of `serialize()`, `json_encode()`, `==` on arrays, `array_map()` and `array_walk_recursive()`, 200 of `==` on objects, `var_dump()` and `__toString()`) and none of the checked paths below reaches the RangeError. The price is the last third: nesting between the Error's depth and the browser's limit worked on 8.5.12-1 and throws the Error now. Levels of nesting:

| path | the browser allows | 8.5.12-2 | 8.5.12-3 |
| --- | --- | --- | --- |
| `serialize()` of arrays or objects | 958 | 181 | 627 |
| `__serialize()` returning a nested object | 1974 | 183 | 632 |
| `json_encode()` of arrays / objects | 1124 / 1172 | 124 | 650 |
| `JsonSerializable` returning a nested object | 749 | 92 | 481 |
| `==` on arrays / `===` on arrays | 936 / 1322 | 188 / 192 | 610 / 619 |
| `==` on `stdClass` objects / objects with declared properties | 737 / 1758 | 94 / 186 | 401 / 1143 |
| `var_dump()` / `debug_zval_dump()` | 2430 / 1579 | 166 / 167 | 1395 / 1023 |
| `count(…, COUNT_RECURSIVE)` | over 3000 | 191 | 2538 |
| `array_walk_recursive()` | 2633 | 182 | 1711 |
| `array_replace_recursive()` | 1311 | 191 | 618 |
| `http_build_query()` | 1264 | 188 | 823 |
| `mb_convert_variables()` | 2999 | 191 | 1626 |
| `compact()` | over 3000 | 188 | 1586 |
| DOM `normalize()` / `isEqualNode()` / `Dom\XMLDocument::saveXml()` | over 3000 / 2110 / 1858 | 191 / 192 / 184 | 1307 / 1308 / 1208 |
| compiling nested calls (`eval`) | 1017 | 93 | 656 |
| compiling a nested constant array (`eval`) | 1499 | RangeError at 1755 | 967 |
| `array_map()`, `array_filter()`, `array_reduce()`, `__invoke` | 795 to 889 | 177 | 538 |
| `usort()`, `uasort()`, `uksort()` callbacks | 327 to 363 | 174 | 212 |
| `array_udiff()` callbacks | 561 | 161 | 208 |
| `preg_replace_callback()` | 372 | 172 | 242 |
| `SplHeap::compare()` | 449 | 171 | 292 |
| `__toString()` / a `Stringable` argument | 545 / 479 | 117 / 141 | 285 / 311 |
| `IteratorAggregate::getIterator()` | 544 | 175 | 354 |
| `ArrayAccess` | 596 | 171 | 387 |
| `__get()`, `__set()`, `__isset()` | 645 to 687 | 167 to 175 | 405 to 413 |
| `__destruct()` | 672 | 176 | 436 |
| `array_walk()` callbacks | 659 | 91 | 412 |
| `ReflectionFunction::invoke()` | 690 | 176 | 535 |

- The margins are measured against Chrome's V8 with its baseline compiler (Liftoff), on slicc-kernel 1.146.5. slicc drives Chromium-based browsers, and the four review browsers of homescoop's CI are Chromium too: the pull request's and npm's package, each with the extension and the cli kernel. Firefox (SpiderMonkey) and Safari (JavaScriptCore) size their stacks and frames differently and are unmeasured, so none of the depths above, the deepest row (`count(…, COUNT_RECURSIVE)` at 2538) included, says anything about them.
- Every call from C back into PHP passes `execute_ex`, whose pad is sized for `array_map()`; the heavier paths above have pads of their own on top. A path that isn't listed and costs the browser's stack much more per level than `array_map()` (`ReflectionFunction::invoke()` stops at 78% of its limit, with no pad of its own) could still reach the RangeError.
- `-d zend.max_allowed_stack_size=<bytes>` sets a different budget, and the depths scale with it. Above 2 MiB, paths reach the RangeError again. `-1` turns the check off: then a path goes as deep as the browser allows and ends in the RangeError, as on 8.5.12-1 (the pads stay within the 8 MiB shadow stack: the most a path takes on the way, `__serialize()` at 1974 levels, is about 6 MiB).

## Not available

- **Fibers:** a wasm call stack can't be switched, so `Fiber::start()` throws a `FiberError` (`patches/0002`). Code that uses Fibers (Revolt, AMPHP v3) doesn't run; code that only checks for the class does.
- **`php -a`:** the interactive shell needs the readline extension, which isn't built.
- **Extensions:** sockets (WASIX has no ancillary data and no interface ioctls), curl, gd, intl, sodium, zip, ffi, and loading extensions with `dl()`.
- **OPcache** is built in but has no shared memory here, so it caches nothing (`opcache.enable_cli` stays off).
- **Deep recursion inside C without PHP's check:** a few paths have no stack check in PHP itself, and still end `php` with `RangeError: Maximum call stack size exceeded` when the browser's native stack runs out. They are `print_r()` past about 1200 levels of nesting, `var_export()` past about 1500, `unserialize()` past about 1850 (its own `unserialize_max_depth` is 4096), `array_merge_recursive()` past about 2250, and freeing an array nested more than about 3000 levels deep.

## Source

PHP 8.5.12 from php.net, with the patches in `patches/` (their headers say why), plus libxml2 and SQLite, which this recipe builds; `SOURCES.md` lists every source and its sha256.
