# `@ai-ecoverse/wasix-ruby`

MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.

Built on wasix-sysroot 2025.9.30-28 or later (the WASIX libc and headers; see
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
with `#!/usr/bin/env ruby`, so they also run by path.

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
  pid].pack("s s x4 q q l x4")` (32 bytes). `File#flock` is unchanged: an
  advisory no-op that succeeds (`bundle install` and `gem install` lock
  their files with it).
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
