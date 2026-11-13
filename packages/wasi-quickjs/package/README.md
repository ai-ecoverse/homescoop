# @ai-ecoverse/wasi-quickjs

[QuickJS-NG](https://github.com/quickjs-ng/quickjs), a small JavaScript
interpreter, as a WASI preview1 command for SLICC: `qjs`.

It is a plain wasm program (`"abi": "wasi"`, no glue), so it runs wherever
slicc-kernel runs WASI programs, including the async process host of a
Cloudflare Durable Object, where JS programs such as `node` and `jsh` don't
run.

```sh
qjs -e 'console.log(1 + 1)'
qjs script.js arg1 arg2        # scriptArgs is ["script.js", "arg1", "arg2"]
qjs < script.js                # stdin is the script when it isn't a terminal
cat data.json | qjs --std -e 'console.log(JSON.parse(std.in.readAsString()).name)'
qjs main.mjs                   # ES modules, imports by relative path
qjs                            # the REPL, on a terminal
```

`qjs:std` and `qjs:os` give files (`std.open`, `std.loadFile`,
`std.writeFile`, `os.readdir`, `os.stat`, `os.rename`, …), the environment,
timers (`os.setTimeout`, `os.sleepAsync`) and `std.exit`. `--std` makes
`std`, `os` and `bjson` globals for a classic script.

`bin/qjs.wasm` is QuickJS-NG `0.18.0` from its release source, built by
homescoop as upstream builds its `qjs-wasi.wasm` (CMake with wasi-sdk 34),
with three patches:

- **The working directory.** wasi-libc starts every program in `/`, so
  `std.loadFile('tmp/f')` in `/home/u` read `/tmp/f`, and `os.getcwd()` was
  `/`. qjs now starts in the directory it runs in. `PWD` names it only when
  it is that directory, so a stale one (Node's `spawn` with `cwd` leaves it)
  is ignored. `/` is the root (the command preopens it).
- **Scripts on stdin.** Without a file argument, upstream's qjs starts the
  REPL on any stdin, so `qjs < f.js` and `cmd | qjs` echoed the script into
  the line editor and never exited. Here stdin is run as a script when it
  isn't a terminal (module or not, as for a file); `qjs -` reads it too.
- **The stack limit.** The JS stack limit is 512 KiB (upstream: 1 MiB), so
  that unbounded recursion throws a `RangeError` you can catch in the async
  process host too, where the wasm engine's own stack is smaller and
  upstream's limit let it run out first (the process ended). About 1,500
  nested JS calls fit. `--stack-size <KiB>` sets another limit.

**Memory.** The module's initial memory is 1.2 MiB (19 wasm pages): the
linker's minimum, static data plus 1 MiB of C stack. The heap grows as a
script needs it, with no maximum; `--memory-limit <KiB>` caps it (a script
over it ends with `InternalError: out of memory`, status 1). On Cloudflare,
programs share a Dynamic Worker's 64 MiB budget, so qjs takes little of it
until a script allocates.

Exit status: `std.exit(n)` is `n & 255`; an uncaught exception, an unhandled
promise rejection, a syntax error or a missing script is 1, with the error
on stderr.

Not in this build, because WASI preview1 has no processes, pipes, signals
or terminal modes:

- `std.popen`, `std.tmpfile`, `std.urlGet`;
- `os.exec`, `os.getpid`, `os.waitpid`, `os.pipe`, `os.kill`, `os.dup`,
  `os.dup2`, `os.symlink`, `os.readlink`, `os.lstat`, `os.realpath`,
  `os.mkdtemp`, `os.mkstemp`, `os.cputime`, `os.ttyGetWinSize`,
  `os.ttySetRaw`, `os.Worker`, and the signal numbers other than `SIGINT`,
  `SIGABRT`, `SIGFPE`, `SIGILL`, `SIGSEGV` and `SIGTERM`;
- `qjs -c` (standalone executables) and `qjsc`, the bytecode compiler, which
  this package doesn't ship;
- the REPL's raw mode: on a terminal the REPL reads whole lines, `^D`
  doesn't end it (`.quit` does, or `^C`).

Data nested a few thousand levels deep (`JSON.stringify` of an array 7,000
levels deep) can still exhaust the wasm engine's stack in the async process
host, which ends the process rather than throwing; 3,000 levels work.

Certified on slicc-kernel in the browser and on Node, with
`createNodeKernel()` and `createNodeKernel({ blocking: 'async' })`: `-e`, a
file, `< file`, pipes, files by relative and absolute paths, exit statuses,
ES modules importing each other by relative paths, the working directory
with a stale `PWD`, the REPL on a terminal, and the functions above being
absent.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
