# `@ai-ecoverse/wasix-ruby`

MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.

Built on wasix-sysroot 2025.9.30-27 or later (the WASIX libc and headers; see
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
