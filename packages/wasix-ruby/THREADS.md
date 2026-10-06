# wasix-ruby threads (WASIX + full Asyncify)

## Root cause (tid3 exits without CHILD)
Thread entry `EC_PUSH_TAG` / `EC_EXEC_TAG` calls `rb_wasm_setjmp`. Asyncify
unwind is only caught/rewound by `rb_wasm_rt_start` (`wasm/runtime.c`). Main
runs inside that loop; a new pthread's `wasi_thread_start` does **not**, so the
unwind escapes and the worker returns (`wasm-thread-exit`) without running the
Ruby block.

## Fix (homescoop patch `wasm-thread-asyncify-tls.patch`)
1. **Trampoline** in `thread_pthread.c` (`WASIX_WASM_THREAD_RT`):
   `native_thread_create` starts `nt_start_wasm_trampoline`, which records the
   per-thread stack base then runs `nt_start` inside `rb_wasm_rt_start`
   (argc/argv-shaped args).
2. **TLS**: `_Thread_local` for Asyncify/jmp/fiber/scan state in
   `wasm/{asyncify.h,setjmp.c,fiber.c,machine.c,runtime.c}` (wasix-libc TLS).

## Acceptance
```ruby
$stdout.sync = true
t = Thread.new { puts "CHILD"; 42 }
puts t.value
```
Expect `CHILD` then `42`. Then Queue / ConditionVariable / Mutex across 2 threads.

## Kernel-ops (pre-fix)
| Worker | Role | Behavior |
|--------|------|----------|
| tid2   | timer thread | alive; fd-select |
| tid3   | user worker | fd-info/write then wasm-thread-exit; no CHILD |

## Homescoop cut (parent)
- Keep `--with-thread=pthread` (do **not** use `thread=none`).
- Socket C ext with CMSG / `MSG_CONTROL` undef.
- Spawn: posix_spawn → proc_spawn3; `bin/ruby` = `#!wasm`; full gemspec lib.
