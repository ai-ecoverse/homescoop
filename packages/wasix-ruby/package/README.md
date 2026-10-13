# `@ai-ecoverse/wasix-ruby`

MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.

Built on wasix-sysroot 2025.9.30-27 (the WASIX libc and headers; see
PRESTAGE.md). `Gem.ruby` and `RbConfig.ruby` are the package's own
`bin/ruby` (`/node_modules/@ai-ecoverse/wasix-ruby/bin/ruby` in a flat
install), the same interpreter as the `ruby` command on PATH.

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

That covers Ruby child processes (`system`, `spawn`, `bundle exec`, …). To run those gems **by name from your shell**, add the same user gem bin directory to the host PATH, e.g. in `~/.bashrc`:

```bash
export PATH="$HOME/.local/share/gem/ruby/3.4.0/bin:$PATH"
```
