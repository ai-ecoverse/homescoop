# Negative proof (wasix-ruby)

## File.utime(nil, nil) sets 1970 (published 3.4.11-10, wasix-sysroot -20)

`times.mjs` (homescoop#294): 3.4.11-10's `File.utime(nil, nil, f)` and `FileUtils.touch(f)` call the libc's `utimensat(…, NULL)`, which up to wasix-sysroot -26 sent explicit times 0/0, so the file's mtime becomes 0 instead of now; `Process.times` mixed the wall clock into the CPU fields.

## Gem.ruby is the `#!wasm` marker (published 3.4.11-11)

`launcher.mjs` (homescoop#305): on 3.4.11-11 `Gem.ruby` and `RbConfig.ruby` are `…/wasix-ruby/bin/ruby`, the 7-byte `#!wasm` marker, so `system(Gem.ruby, "-e", "exit 3")` gives 127 (`true /node_modules/@ai-ecoverse/wasix-ruby/bin/ruby 127` against `true /usr/bin/ruby 3`), and a RubyGems-installed executable (shebang `#!…/bin/ruby`) gives "bad interpreter". Checked on slicc-kernel 1.71.1 and 1.92.0.

## 3.4.11-13: negative 3.4.11-12 (wasix-sysroot -28)

3.4.11-13 is a rebuild on wasix-sysroot -28. Ruby has no signal-mask API, so the libc's real masks are not observable from Ruby. The -28 behaviour itself is the sysroot's cert (r28/r28w). On 3.4.11-12 (#368's artifact, sha256 a2efdbf4…, slicc-kernel 1.93.0 Node entry), `sysroot28.mjs` traps 20 of 20 too and fails on the toolchain record (`wasix-sysroot 2025.9.30-27|wasix-sysroot 2025.9.30-27`). The other specs are the regression run of MRI on the -28 libc.

## 3.4.11-14: flock without the patch; negative 3.4.11-13 (wasix-sysroot -28)

- **flock.mjs** without `patches/flock-wasi-noop.patch`: a ladder-build dispatch (publish=false, run 38867541728, sha256 `a86db77d…`) of a scratch branch that deletes the patch, run on slicc-kernel 1.93.0's Node entry, 2026-10-16. It fails at the first case, rc 1: `-e:1:in 'File#flock': Invalid argument @ rb_file_flock - /tmp/flock-direct (Errno::EINVAL)`. In real use, `bundle install --local` says `There was an error creating /tmp/bi/vendor/bundle/ruby/3.4.0/bundler.lock. The underlying system error is Errno::EINVAL: Invalid argument @ rb_file_flock`, and `gem install --local` of the cached rake says `ERROR: While executing gem ... (Errno::EINVAL) Invalid argument @ rb_file_flock - /tmp/gi/bin/rake.lock`. With the patch, the same tree (ladder-pr's 3.4.11-13-on-sysroot-30 build for #563) passes, as does the published 3.4.11-13.
- **locks.mjs** on the published 3.4.11-13 (slicc-kernel 1.100.3 and 1.93.0): rc 1, `uninitialized constant Fcntl::F_GETLK (NameError)`. sysroot -28's headers define no record-lock commands, so ruby's fcntl extension has none.
- **launcher.mjs**'s load-path case on 3.4.11-13 gives `6`: RUBYLIB names `lib/ruby/site_ruby/3.4.0`, `site_ruby/3.4.0/wasm32-wasi`, `vendor_ruby/3.4.0` and `vendor_ruby/3.4.0/wasm32-wasi`, none of which is in the tarball. With RUBYLIB set to the two existing directories, `ruby -rirb -e 1` makes 6,637 WASI calls instead of 7,901 (`SLICC_WASI_STATS=1`, slicc-kernel 1.100.3's Node entry).
- **sysroot28.mjs**'s toolchain record expects -30. 3.4.11-13 says `wasix-sysroot 2025.9.30-28|wasix-sysroot 2025.9.30-28`.

## 3.4.11-15: the engines floor (homescoop#552)

`locks.mjs` against the published 3.4.11-14 on slicc-kernel 1.100.3's Node entry, 2026-10-16: FAIL at `engines.slicc-kernel is >=1.100.0 … : >=1.44.0`. -14 admitted kernels without `slicc.fcntl_lock`, where every lock is granted locally. With -15's manifest over the same files, the spec passes (real locks: child EAGAIN, F_SETLKW waited). The spec has no local-answer branch any more, so it also fails on a kernel before 1.100.0.

## bundle exec (homescoop#379, 2026-10-16)

`cert/bundle-exec.mjs` with the published 3.4.11-15 on slicc-kernel 1.100.3: FAIL, rc 1, because `/usr/bin/ruby` is a 0-byte command entry (slicc-kernel#762) and every `bundle exec ruby` warns `/usr/bin/ruby is empty`. On 1.106.2, the cert kernel now, the same binary passes, as does 3.4.11-16 (a packaging-only README release) with all twelve specs. The fix is the kernel's; the spec pins it.

## 3.4.11-17: File#flock excludes other processes (homescoop#578, 2026-10-16)

`cert/flock.mjs` against the published 3.4.11-16 (sha256 of npm's tarball, slicc-kernel 1.106.2, users enforce): FAIL at the first case, `same=0 0 0 0 | child=0 0 | unlock=0 | blocking=0:at-once | shared=0:0 0 | readonly=0:0`. While the parent holds `LOCK_EX`, the spawned child gets 0 for `LOCK_EX|LOCK_NB` and `LOCK_SH|LOCK_NB`, its blocking `LOCK_EX` returns at once, and a writer gets in beside a shared holder and beside a read-only `LOCK_EX`. #578's `IO.popen` one-liner prints `0` (Linux: `false`), and a second `bundle install` on the same bundle path takes `bundler.lock` while another process holds it (`held, bundle-try, bundle-got 0, released`). `patches/flock-wasi-noop.patch` answered every `flock` with 0. 3.4.11-17 (`patches/flock-wasi-fcntl.patch`) passes all of it, as root and as cone, and the other twelve specs pass on the same build (wasix-sysroot -32).

What it still can't exclude: `flock` on something that isn't a regular file (a pipe, a terminal, `/dev/null`, a directory) is granted and excludes nobody, since slicc-kernel keeps record locks on regular files only (ai-ecoverse/slicc-kernel#757). `LOCK_EX` on a read-only handle is a read lock, so two of them are both granted (homescoop#758's pattern): open a lock file for writing to exclude. And these are fcntl semantics: a second handle on the file in the same process isn't refused, and closing any handle on it drops the process's lock.

## 3.4.11-18: libc flock (wasix-sysroot -34; 2026-10-17)

The new pipe row of `cert/flock.mjs` against the published 3.4.11-17 on slicc-kernel 1.120.2 (Node entry): FAIL, `0 0 0`. -17's whole-file fcntl emulation (`patches/flock-wasi-fcntl.patch`) grants every lock on something that isn't a regular file, so a pipe's read end gets `LOCK_EX|LOCK_NB` while its write end holds `LOCK_EX`. -18 (libc's flock, per open file description) gives `0 false 0`, as Linux does. That fixes the non-regular-files gap noted above (#578, #854).

## 3.4.11-20: inputs by version (homescoop#637, #1045, #989; 2026-10-18)

- **#637, `package-meta.mjs`:** the published 3.4.11-19 on slicc-kernel 1.120.2 under users enforce fails 2 of 6 assertions. `homescoop.openssl` is `linked against /home/runner/work/homescoop/homescoop/packages/wasix-ruby/work/deps/wasix-openssl/package (OpenSSL 3.x; …`, and it's the one package.json string holding a build path. The same tarball with only that string set to what 3.4.11-20's build.sh writes (`@ai-ecoverse/wasix-openssl 3.5.9-4 (OpenSSL 3.5.9; …`) passes: it agrees with the notices' `## OpenSSL 3.5.9 (@ai-ecoverse/wasix-openssl 3.5.9-4)`, and `OPENSSL_LIBRARY_VERSION` is `OpenSSL 3.5.9`.
- **#1045:** the checklist's zlib and openssl rows name `wasix-zlib 1.3.1` / `wasix-openssl 3.5.9` without a build number. `package-meta.mjs` checks the build against the notices.
- **#989:** fixed by 3.4.11-18. It raised `engines.slicc-kernel` to `>=1.120.0` and the cert kernel to 1.120.2, which has `slicc.flock`, and updated `sysroot28.mjs` to -34. `flock.mjs` passes on 3.4.11-18 and -19. What was left: `cert/meta.json` still had a `patches/flock-wasi-fcntl.patch` entry for a file that's gone, and `recipe.yaml`'s comment still described it. Both are removed.


## 3.4.11-21: bundled C-extension gems, interruptible locks, load path, rbconfig (homescoop#596, #869, #597, #1114; 2026-10-20)

Against the published 3.4.11-20 on the cert kernel slicc-kernel 1.132.1, users enforce, `--spec bundled-gems.mjs --spec flock-interrupt.mjs --spec launcher.mjs --spec package-meta.mjs --spec sysroot28.mjs`:
- **#596, `bundled-gems.mjs`:** FAIL, 11 of 11 assertions. `require "bigdecimal"` warns `bigdecimal is not part of the default gems starting from Ruby 3.4.0` and raises `cannot load such file -- bigdecimal (LoadError)`. `gem list` has no bigdecimal, racc, nkf, syslog, debug or rbs, because build.sh deleted their `ext/` and rbinstall skipped each gem.
- **#869, `flock-interrupt.mjs`:** on -20 the first row's `Timeout.timeout(1) { flock(LOCK_EX) }` doesn't return until the holder exits (3 s). A first draft of the spec left the timed-out handle open, and it then took the lock, so the next row waited for ever (the harness gave up after 120 s). The committed spec closes every handle, so -20 reports `late` for each interrupt row instead of hanging.
- **#597, `launcher.mjs`:** -20's `$LOAD_PATH` has 8 missing `/nonexistent-ruby-prefix/...` directories (the issue's list). The new assertion expects none.
- **#1114, `package-meta.mjs`:** -20's `RbConfig::CONFIG` has 9 values holding `/home/runner/work/homescoop/homescoop/packages/wasix-ruby/work/...` (`configure_args`, `CPPFLAGS`, `LDFLAGS`, `DLDFLAGS`, `MAINLIBS`, `LIBS`, `CC_VERSION_MESSAGE`, ...). -21's build.sh names the tree `/nonexistent-ruby-build` and fails if a build path is left.
- **`sysroot28.mjs`:** expects wasix-sysroot 2025.9.30-39 from PRESTAGE.md and THIRD-PARTY-NOTICES.md. -20 says -34.
- **#1013:** fixed in 3.4.11-18 and -20. `locks.mjs` asserts a floor of at least `>=1.100.0` by number, and `cert/meta.json` has no `flock-wasi-fcntl.patch` entry. -21 also rewrites the `cert/flock.mjs` row that still described fcntl record locks.
