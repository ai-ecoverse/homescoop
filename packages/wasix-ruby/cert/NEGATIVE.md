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
