# `@ai-ecoverse/wasix-ruby`

MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.

Built on wasix-sysroot 2025.9.30-40 (the WASIX libc and headers; see
PRESTAGE.md).

## The interpreter path (3.4.11-12)

`Gem.ruby` and `RbConfig.ruby` are the first `ruby` on PATH outside the
package, which is slicc-kernel's `/usr/bin/ruby` command. Run through it,
ruby gets the command's `RUBYLIB`, `GEM_HOME` and `GEM_PATH` defaults, so
`system(Gem.ruby, "-e", "exit 3")` exits 3 from any process, and RubyGems
writes `#!/usr/bin/ruby` into the gem executables it installs. Without a
`ruby` on PATH they fall back to the package's `bin/ruby`.

`bin/ruby` (`RbConfig::CONFIG["bindir"]`) is the wasm module itself, so the
kernel can exec it by path and use it in a shebang. It doesn't get the
command's environment: started from ruby (which passes its own `RUBYLIB` and
`GEM_*` on) it works fully, but started from a shell without them ruby can't
find RubyGems (`RubyGems were not loaded`). Use `ruby` or `/usr/bin/ruby` from a
shell. The package's `gem`, `bundle`, `rake`, `irb` and `erb` scripts start
with `#!/usr/bin/env ruby`, so they also run by path, as do the gem executables below.

Up to 3.4.11-11 `bin/ruby` was a 7-byte `#!wasm` marker that the kernel
can't exec: `system(Gem.ruby, …)` gave 127, and the executables RubyGems
installed (shebang `#!…/wasix-ruby/bin/ruby`) gave "bad interpreter". Those
executables now run when started from ruby; to make them run from a shell
too, rewrite their shebangs with `gem pristine --only-executables <gem>…`
for the gems you installed (`--all` would also rewrite the package's own
gems).

Since 3.4.11-8, single-fd waits (`IO#wait_readable`, blocking `TCPSocket.new`,
`Net::HTTP`, blocking `SSLSocket#connect`/`#accept`) use poll(): WASIX's select()
rejects an exception set with ENOSYS, so `IO.select` with a third array still
fails. `io/console` is built, so `irb` and reline work.

`TZ` is ignored: wasix-libc's localtime is UTC only (homescoop#193).

## 3.4.11-24: gem install --document ri writes ri data

- **`gem install --document ri` documents the gem** (homescoop#1675): `gem install --document ri <gem>` writes the gem's ri data to `$(gem env gemdir)/doc/<gem>-<version>/ri` as a normal directory, and `ri <Class>` reads it next to the packed core and stdlib documentation. Up to 3.4.11-23 nothing was written and `ri` said `Nothing known about` for the gem's classes, although `gem install` reported success.
- **Opt-in:** a plain `gem install` (and `gem update`) writes no documentation, unlike RubyGems' usual `--document ri` default, because on slicc rdoc adds 4 to 13 seconds per gem: rake takes 2,900 ms without and 7,050 ms with ri, minitest 3,140 and 7,620 ms, csv 3,520 and 9,000 ms, rexml 3,160 and 15,740 ms (the cert kernel, the mean of two runs each). The package's `rubygems/defaults/operating_system.rb` (`patches/rubygems-no-document-default-wasi.patch`) sets `gem: --no-document` as the lowest-priority default. `--document ri` on the command line overrides it, and so does a `gem:` line in `~/.gemrc` (e.g. `gem: --document ri` to document every install).
- **Why:** in Ruby 3.4.11's sources, RubyGems 3.6.9's `rubygems/rdoc.rb` registers no install hook for an rdoc of 6.9.0 or later, since such an rdoc registers its own from its `rubygems_plugin.rb`. Ruby's rdoc 6.14.0 is a default gem, which doesn't ship that plugin file, so no hook was registered at all. `patches/rubygems-rdoc-hook-wasi.patch` registers rdoc's compatibility hook (`RDoc::RubygemsHook.generation_hook`, which acts only when rdoc is the default gem) in that case. A newer rdoc installed with `gem install rdoc` brings its own plugin, and the compatibility hook then does nothing.
- **Limits:** as in RubyGems elsewhere, `gem uninstall` leaves a gem's `doc/` directory behind, since `gem uninstall` doesn't load the rdoc hook. The ri.pack bounds checks of 3.4.11-23 are unchanged.

## 3.4.11-23: ri has Ruby's documentation

- **ri** (homescoop#1622): `ri String#upcase`, `ri JSON.parse`, `ri Gem::Specification` and `ri --list` cover the core classes and the standard library, including RubyGems and Bundler (1,387 classes and modules). build.sh generates the ri data from Ruby's source with Ruby's own rdoc 6.14.0, as `make install-rdoc` would. Up to 3.4.11-22 the package was built without it, so `ri` printed `Nothing known about String` for everything.
- **One file, not 15,000:** rdoc writes one file per class and method, about 15,400 files and 12 MB, which would be most of the package's files, and on slicc each one is a separate write at install time (a cert run's install went from about 30 s to over 4 min). The package ships them as one file, `share/ri/<API version>/system/ri.pack`: an index (8 bytes of big-endian length, then a Marshal hash of each path to its offset and length) followed by the files' bytes. `patches/rdoc-ri-pack-wasi.patch` makes rdoc's `RDoc::Store` read a store's files from its `ri.pack` when there is one, and from the directory otherwise. A pack whose index or entries don't fit inside the file, or whose index or an entry is over 16 MiB, is ignored as a whole, so ri says `Nothing known about` instead of reading outside it. ri data that `rdoc --ri` or `gem install --document ri` writes works as usual. The cost is 12 MB of disk and about 2.4 MB of download (the tarball goes from 13.1 to 15.5 MB).
- **Limits:** a newer rdoc installed with `gem install rdoc` doesn't have the patch, so its `ri` finds no documentation for core and stdlib. ri doesn't cover gems installed later unless they were installed with `--document ri` (which wrote nothing up to this release; see 3.4.11-24). In a terminal, ri uses a pager when it finds one; `ri -T` never does.
- **Tests** (homescoop#1017): `cert/gem-executables.mjs` drives a real `rdbg` session (a breakpoint, `p x`), `typeprof` and `rdoc`; `cert/bundled-gems.mjs` runs `bundle install --local` and `bundle exec` with bigdecimal, racc and nkf; `cert/flock-interrupt.mjs` interrupts a blocking `LOCK_SH` and raises into threads blocked in `File#flock` and `F_SETLKW`. No behaviour change there.

## 3.4.11-22: the gems' executables are commands

- **Commands** (homescoop#1390): `rdbg` (the debug gem's debugger), `rbs`, `racc`, `typeprof`, `rdoc`, `ri`, `syntax_suggest` and `bundler` run by name, like `gem` and `rake`. Each is a RubyGems binstub in the package's `bin/` that loads the gem's own executable. Up to 3.4.11-21 the gems were installed but their executables weren't on PATH (`rdbg: command not found`); `ruby -rdebug` and `binding.break` worked.
- **Sysroot:** wasix-sysroot 2025.9.30-40, whose `malloc` also allocates from the initial memory (homescoop#1287). The package keeps the default initial memory and grows from there: homescoop sizes a threaded package's initial heap from a peak measured in the allocating thread, and ruby's build has no such gauge yet.

## 3.4.11-21: bundled gems with C extensions, interruptible locks, a clean load path

- **Bundled gems with a C extension** (homescoop#596): bigdecimal, racc (`racc/cparse`), nkf, syslog, debug and rbs (the versions in `gems/bundled_gems`) are installed, and their extensions are linked into `ruby`. `require "bigdecimal"` works, and so do activesupport and anything else that needs it. `gem list` shows them, and Bundler takes them from the package. A newer version of one of them can't be installed with `gem install`, because that needs a compiler. Up to 3.4.11-20 they were left out and `require "bigdecimal"` was a LoadError.
- **Interruptible locks** (homescoop#869): `Timeout.timeout`, `Thread#raise` and `Thread#kill` interrupt a blocking `File#flock` or `IO#fcntl(F_SETLKW)`. On slicc the wait is a loop of non-blocking tries with a 20 ms sleep in between, so a lock can come free up to 20 ms before ruby takes it. Up to 3.4.11-20 the interrupt waited until the holder let go.
- **Load path** (homescoop#597): `$LOAD_PATH` holds only directories that exist. The package's stdlib comes from `WASIX_RUBY_PREFIX` (the command sets it to the package), so the command no longer sets `RUBYLIB`. Yours comes first, and there's no site or vendor directory. Up to 3.4.11-20, eight missing `/nonexistent-ruby-prefix` directories were probed on every require that missed the stdlib.
- **RbConfig** (homescoop#1114): `RbConfig::CONFIG` names the build tree `/nonexistent-ruby-build` instead of the CI runner's checkout, so the bytes don't depend on where it was built.
- **Sysroot:** wasix-sysroot 2025.9.30-39, whose `malloc` refreshes a thread's view of grown shared memory (homescoop#1287).

## 3.4.11-20: inputs recorded by version

`package.json`'s `homescoop.openssl` names the wasix-openssl package
version and the OpenSSL version it links, as THIRD-PARTY-NOTICES.md does;
up to 3.4.11-19 it was the CI runner's build path (homescoop#637). Same
sources and inputs as 3.4.11-19.

## 3.4.11-18: real File#flock (wasix-sysroot -34; slicc-kernel ≥ 1.120.0)

- **What changed:** `File#flock` is libc's `flock(2)`, through slicc-kernel's `slicc.flock`.
- **Semantics, as on Linux:**
  - a lock belongs to the open file description, on any IO: a file, a pipe, a terminal, a socket or a directory;
  - a second `File.open` of the same file, or a pipe's other end, conflicts;
  - a `dup` and a spawned child's inherited descriptor share the lock;
  - `LOCK_EX` on a read-only file excludes.
- **Before:** -17 used whole-file fcntl record locks, which belonged to the process, covered regular files only, and on a read-only handle took a read lock instead of `LOCK_EX`.
- **Kernel:** this needs slicc-kernel ≥ 1.120.0 (engines).

## 3.4.11-17: File#flock excludes other processes (up to -17)

`File#flock` takes whole-file `fcntl` record locks (`LOCK_SH` → read lock,
`LOCK_EX` → write lock, `LOCK_UN` → unlock; `LOCK_NB` doesn't wait), which
slicc-kernel (≥ 1.100.0) enforces between processes (homescoop#578). Up to
-16 every `flock` returned 0 and excluded nobody, so two `bundle install` or
`gem install` runs on one bundle path or gem directory didn't wait for each
other. Now a second process's `flock(File::LOCK_EX | File::LOCK_NB)` is
`false` while another holds the lock, and a blocking one waits.

These are `fcntl` semantics, as wasix-perl's `flock` has them since
5.42.0-15: a lock belongs to the process, so a second handle on the same
file in the same process isn't refused, and closing any handle on the file
drops the process's lock on it. `fcntl` wants a writable handle for a write
lock, so `LOCK_EX` on a read-only handle takes a read lock: it keeps writers
out, but two read-only `LOCK_EX` holders are both granted; open a lock file
for writing to exclude (homescoop#758). `flock` on something that isn't a
regular file (a pipe, STDOUT, `/dev/null`, a directory) succeeds and excludes
nobody, since slicc-kernel keeps record locks on regular files only
(ai-ecoverse/slicc-kernel#757).

A real rebuild, on wasix-sysroot 2025.9.30-32.

## 3.4.11-16: the engines floor, and bundle exec

The `engines` floor (slicc-kernel ≥ 1.100.0, below) is enforced from
slicc-kernel 1.106.2 on: its command catalog refuses a package whose
`engines.slicc-kernel` the running kernel doesn't meet
(ai-ecoverse/slicc-kernel#797). Older kernels install the package without a
warning, and there `fcntl` record locks aren't real: use slicc-kernel ≥
1.100.0 (homescoop#651).

From slicc-kernel 1.106.2 the commands' `/usr/bin` entries are real files
(slicc-kernel#762), so `bundle exec ruby …` no longer warns
`/usr/bin/ruby is empty` (homescoop#379). Older kernels print that warning,
and the command still runs.

## 3.4.11-15: needs slicc-kernel ≥ 1.100.0

A packaging-only release of 3.4.11-14 (the same files): `engines` now asks
for slicc-kernel ≥ 1.100.0, the first kernel with `slicc.fcntl_lock`. On an
older kernel the libc grants every `IO#fcntl` record lock locally, so two
processes could both hold a write lock on the same bytes and lose data;
refusing to install there is the honest answer (homescoop#552). Up to -14
`engines` said ≥ 1.44.0.

## 3.4.11-14: wasix-sysroot 2025.9.30-30

- POSIX record locks: `require "fcntl"` now defines `Fcntl::F_GETLK`,
  `F_SETLK`, `F_SETLKW` and `F_RDLCK`/`F_WRLCK`/`F_UNLCK` (up to 3.4.11-13
  they were missing: `NameError`), and `IO#fcntl` passes them to slicc-kernel
  (≥ 1.100.0), which keeps the locks per process, as Linux does. A
  `Process.spawn`ed ruby asking for a write lock on a range another process
  holds gets `Errno::EAGAIN`, `F_SETLKW` waits for the unlock, and `F_GETLK`
  names the holder. On an older kernel every lock is granted locally and
  `F_GETLK` answers `F_UNLCK` (hence -15's `engines` floor). The struct is `[type, whence, start, len,
  pid].pack("s s x4 q q l x4")` (32 bytes). `File#flock` was unchanged: an
  advisory no-op that succeeded (real locks since 3.4.11-17).
- `RUBYLIB` names only the package's library directories that exist,
  `lib/ruby/3.4.0` and its `wasm32-wasi`. Up to 3.4.11-13 it also named
  `site_ruby` and `vendor_ruby` (and their `wasm32-wasi`), which npm never
  packs because they are empty, so every require of the standard library
  first probed four missing directories. `ruby -rirb -e 1` makes about 16%
  fewer file-system calls (slicc-kernel#774).
- wasix-sysroot -29 and -30 also bring `poll` with `events` 0 and named
  semaphores (no Ruby API uses them).

## 3.4.11-13: wasix-sysroot 2025.9.30-28

A rebuild on wasix-sysroot -28, whose libc keeps real signal masks through
slicc-kernel (≥ 1.88.0), so MRI's own `pthread_sigmask`/`sigprocmask` calls
now take effect. Ruby has no API of its own for masks, so
nothing changes at the Ruby level: `Signal.trap` handlers still run when
other threads are busy.

## 3.4.11-11: wasix-sysroot 2025.9.30-27

- `File.utime(nil, nil, f)` and `FileUtils.touch(f)` set the times to now;
  up to 3.4.11-10 they set them to 0 (1970), from wasix-sysroot's broken
  `utimensat(NULL)` (homescoop#294).
- `Process.times` reports the process CPU time slicc-kernel keeps; system and
  children's times are 0.
- An empty path is ENOENT (`File.exist?("")` is false), as on Linux.
- Files have owners on slicc-kernel ≥ 1.59.0 with users on: `File.chown`,
  `File::Stat#uid`/`#gid` and `File.owned?` are the kernel's, and
  `File.readable?`/`writable?`/`executable?` ask it (slicc-kernel ≥ 1.63.0).

## Gem executables on PATH

Command env puts user gem bins ahead of the package:

```text
${HOME}/.local/share/gem/ruby/3.4.0/bin:${package}/bin:${PATH}
```

Those are defaults: a `PATH` the caller already has wins, as it does when you
start `ruby` from bash. To run gem executables **by name**, add the user gem
bin directory to your PATH, e.g. in `~/.bashrc`:

```bash
export PATH="$HOME/.local/share/gem/ruby/3.4.0/bin:$PATH"
```
