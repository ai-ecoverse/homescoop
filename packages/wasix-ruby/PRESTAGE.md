# wasix-ruby 3.4.11-6

Built against wasix-sysroot **2025.9.30-14**. **No epoll**: SLICC returns ENOSYS (52)
for `epoll_create`; MRI is compiled with `USE_MN_THREADS=0` and
`HAVE_SYS_EPOLL_H=0` (also kqueue/eventfd/timerfd off) so it uses poll()/timer-thread.

Configure `--prefix=/nonexistent-ruby-prefix` so baked-in `$LOAD_PATH` never matches a real
VFS path. Manifest `RUBYLIB` is authoritative.

## Asyncify (buffer sizing — priority over process/fork)

- **POSTLINK** (from configure `wasi*`): `$(WASMOPT) --asyncify $(wasmoptflags)`
  — **no** `asyncify-ignore-imports`, **no** restricted import list.
- Spill buffers `WASM_{SETJMP,FIBER,SCAN}_STACK_BUFFER_SIZE=65536`.

## OpenSSL
linked against /tmp/wasix-openssl-prefix (OpenSSL 3.x; honours SSL_CERT_FILE). Socket C ext built with HAVE_STRUCT_MSGHDR_MSG_CONTROL / CMSG_* forced off (WASIX ancillary data incomplete).

## Relocation / RUBYLIB
- Stdlib under `lib/ruby/<API>` (e.g. **3.4.0**), arch `…/wasm32-wasi/rbconfig.rb`.
- `RUBYLIB` = site_ruby + vendor_ruby + api (+ each `/wasm32-wasi`), all `${package}/…`.
- **Certify only** at `/shared/lib/node_modules/@ai-ecoverse/wasix-ruby` with
  manifest env. Never at `/ruby` (hides missing RUBYLIB — -3 false pass).

## Gems / flock / uid (-5)
- `GEM_HOME=${HOME}/.local/share/gem/ruby/3.4.0` (writable under SLICC HOME).
- `GEM_PATH=${HOME}/.local/share/gem/ruby/3.4.0:${package}/lib/ruby/gems/3.4.0`.
- `File#flock` / `missing/flock.c` `__wasi__`: advisory **no-op success** (was EINVAL).
- `getuid`/`geteuid`/`getgid`/`getegid` → **1000** via wasix-sysroot `slicc_identity`
  (injected into `wasm32-wasi` libc used by wasixcc, not only wasip1).

## Gems / PATH / SLICC #3735
- `PATH=${package}/bin:${PATH}`.
- `gem`/`bundle`/`rake` `args: ["${package}/bin/…"]` need **SLICC PR #3735**.
  Until merged, those commands only work in harnesses that have it.

## PRESTAGE (host)
- no `epoll_create (errno:` in wasm; date_core linked; `nt_start_wasm_trampoline`
- package.json `RUBYLIB` contains `wasm32-wasi` and `lib/ruby/3.4.0`
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
Process.uid # => 1000
f = File.open("flock-test", "w"); f.flock(File::LOCK_EX); f.close # no Errno::EINVAL
```
Plus Queue/CV/Mutex; `bundle exec rake` when #3735 is available.

## Install acceptance (-5) — certify at real VFS path only
At `/shared/lib/node_modules/@ai-ecoverse/wasix-ruby` with manifest env:
1. `gem env home` → `…/.local/share/gem/ruby/3.4.0` (not under package).
2. `bundle install --local` creates lockfile without `Errno::EINVAL @ rb_file_flock`.
3. `gem install --local --force` from packaged `rake-13.2.1.gem`; spec under
   `HOME/.local/share/gem/ruby/3.4.0`.
Hold npm publish until those three pass.
