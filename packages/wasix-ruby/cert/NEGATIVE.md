# Negative proof (wasix-ruby)

## File.utime(nil, nil) sets 1970 (published 3.4.11-10, wasix-sysroot -20)

`times.mjs` (homescoop#294): 3.4.11-10's `File.utime(nil, nil, f)` and `FileUtils.touch(f)` call the libc's `utimensat(…, NULL)`, which up to wasix-sysroot -26 sent explicit times 0/0, so the file's mtime becomes 0 instead of now; `Process.times` mixed the wall clock into the CPU fields.

## Gem.ruby is the `#!wasm` marker (published 3.4.11-11)

`launcher.mjs` (homescoop#305): on 3.4.11-11 `Gem.ruby` and `RbConfig.ruby` are `…/wasix-ruby/bin/ruby`, the 7-byte `#!wasm` marker, so `system(Gem.ruby, "-e", "exit 3")` gives 127 (`true /node_modules/@ai-ecoverse/wasix-ruby/bin/ruby 127` against `true /usr/bin/ruby 3`), and a RubyGems-installed executable (shebang `#!…/bin/ruby`) gives "bad interpreter". Checked on slicc-kernel 1.71.1 and 1.92.0.
