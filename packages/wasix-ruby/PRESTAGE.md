# wasix-ruby 3.4.11-21

Built against wasix-sysroot **2025.9.30-39**. **No epoll**: SLICC returns ENOSYS (52)
for `epoll_create`; MRI is compiled with `USE_MN_THREADS=0` and
`HAVE_SYS_EPOLL_H=0` (also kqueue/eventfd/timerfd off) so it uses poll()/timer-thread.

Configure `--prefix=/nonexistent-ruby-prefix` so baked-in `$LOAD_PATH` never matches a real
VFS path. The manifest's `WASIX_RUBY_PREFIX=${package}` puts the package's stdlib on the initial load path.

## Asyncify (buffer sizing — priority over process/fork)

- **POSTLINK** (from configure `wasi*`): `$(WASMOPT) --asyncify $(wasmoptflags)`
  — **no** `asyncify-ignore-imports`, **no** restricted import list.
- Spill buffers `WASM_{SETJMP,FIBER,SCAN}_STACK_BUFFER_SIZE=65536`.

## OpenSSL
linked against @ai-ecoverse/wasix-openssl 3.5.9-4 (OpenSSL 3.5.9; honours SSL_CERT_FILE). Socket C ext built with HAVE_STRUCT_MSGHDR_MSG_CONTROL / CMSG_* forced off (WASIX ancillary data incomplete).

## Relocation / WASIX_RUBY_PREFIX
- Stdlib under `lib/ruby/<API>` (e.g. **3.4.0**), arch `…/wasm32-wasi/rbconfig.rb`.
- The initial load path is `$WASIX_RUBY_PREFIX/lib/ruby/<API>` and its `/wasm32-wasi`, with no
  site or vendor directory (homescoop#597); the manifest sets no `RUBYLIB`, so a caller's goes first.
- **Certify only** at `/shared/lib/node_modules/@ai-ecoverse/wasix-ruby` with
  manifest env. Never at `/ruby` (hides a missing load path — -3 false pass).

## Gems / flock / uid (-5)
- `GEM_HOME=${HOME}/.local/share/gem/ruby/3.4.0` (writable under SLICC HOME).
- `GEM_PATH=${HOME}/.local/share/gem/ruby/3.4.0:${package}/lib/ruby/gems/3.4.0`.
- `File#flock`: libc's flock(2) through slicc.flock, per open file description (since 3.4.11-18,
  wasix-sysroot -34; -17 whole-file fcntl record locks, homescoop#578; up to -16 a no-op success).
- `Process.uid`/`euid`/`gid`/`groups`, `Etc.getpwuid` and `Dir.home` come from
  slicc-kernel's process credentials (wasix-sysroot -20, slicc-kernel >= 1.44.0):
  root is uid 0 with home /root; a `kernel.users.add` user gets its own ids.

## Gems / PATH / SLICC #3735
- `PATH=${package}/bin:${PATH}`.
- `gem`/`bundle`/`rake` `args: ["${package}/bin/…"]` need **SLICC PR #3735**.
  Until merged, those commands only work in harnesses that have it.

## PRESTAGE (host)
- no `epoll_create (errno:` in wasm; date_core linked; `nt_start_wasm_trampoline`
- package.json `WASIX_RUBY_PREFIX` is `${package}`, and it sets no `RUBYLIB`
- package.json `GEM_HOME` is under `${HOME}/.local/share/gem`, not `${package}`

## PRESTAGE (SLICC — real install path)
```ruby
RUBY_VERSION
system("echo", "x")
IO.popen(["echo", "x"], &:read)
Process.spawn("echo", "x").then { Process.wait _1 }
require "json"; JSON.parse('{"a":1}')
require "zlib"; require "yaml"; require "date"; Date.today
Fiber.new { :ok }.resume
$stdout.sync = true
t = Thread.new { puts "CHILD"; 42 }; puts t.value
require "openssl"; OpenSSL::OPENSSL_VERSION
require "socket"
Process.uid # => 0 (root, the kernel's default user)
f = File.open("flock-test", "w"); f.flock(File::LOCK_EX); f.close # no Errno::EINVAL; a second process gets false for LOCK_EX|LOCK_NB
```
Plus Queue/CV/Mutex; `bundle exec rake` when #3735 is available.

## Install acceptance (-5) — certify at real VFS path only
At `/shared/lib/node_modules/@ai-ecoverse/wasix-ruby` with manifest env:
1. `gem env home` → `…/.local/share/gem/ruby/3.4.0` (not under package).
2. `bundle install --local` creates lockfile without `Errno::EINVAL @ rb_file_flock`.
3. `gem install --local --force` from packaged `rake-13.2.1.gem`; spec under
   `HOME/.local/share/gem/ruby/3.4.0`.
Hold npm publish until those three pass.
