# Negative proof (wasix-ruby)

## File.utime(nil, nil) sets 1970 (published 3.4.11-10, wasix-sysroot -20)

`times.mjs` (homescoop#294): 3.4.11-10's `File.utime(nil, nil, f)` and `FileUtils.touch(f)` call the libc's `utimensat(…, NULL)`, which up to wasix-sysroot -26 sent explicit times 0/0, so the file's mtime becomes 0 instead of now; `Process.times` mixed the wall clock into the CPU fields.
