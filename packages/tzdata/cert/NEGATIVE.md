# tzdata: negative proof

The package has no WebAssembly, so `prove-negative.mjs` (which empties a
package's wasm modules) proves nothing here. The negatives are data ones,
recorded on slicc-kernel 1.175.1 with wasix-python 3.15.0-6, wasix-perl
5.42.0-22 and wasix-ruby 3.4.11-25 (2026-11-07, homescoop worktree of the
first release, 2026.6.0-1):

1. **The right files with the wrong data.** Every zone file in a copy of the
   tarball replaced by `UTC`'s bytes (still valid TZif, so the links reach a
   TZif file): all three specs fail on their first case, with the clock
   musl gives a program today, before this package:

   ```text
   browser-cert: FAIL packages/tzdata/cert/perl.mjs
   AssertionError [ERR_ASSERTION]: perl TZ=Europe/Berlin
   + actual - expected
   +   jan2026: '12:00 UTC +0000',
   …
   -   jan2026: '13:00 CET +0100',
   …
   browser-cert: FAIL packages/tzdata/cert/python.mjs
   AssertionError [ERR_ASSERTION]: python TZ=Europe/Berlin
   browser-cert: FAIL packages/tzdata/cert/ruby.mjs
   AssertionError [ERR_ASSERTION]: ruby TZ=Europe/Berlin
   cert-run: FAIL tzdata fail
   ```

2. **No files.** A tarball whose `share/zoneinfo` is empty fails every spec
   at the link check (`head: cannot open '/usr/share/zoneinfo/Europe/Berlin'`).

3. **In every run:** the last case of each spec,
   `TZ=:/tmp/no-zoneinfo/Europe/Berlin`, must come out UTC. So a name only
   resolves when the package's file is behind it, and the passing cases
   aren't the kernel's or the browser's zone leaking through. `TZ unset`
   expects Asia/Kolkata from `/etc/localtime`, which is no runner's zone.

`test/tzif.test.mjs` checks its own parser the same way: a truncated file, a
bad magic and a missing footer must each throw.
