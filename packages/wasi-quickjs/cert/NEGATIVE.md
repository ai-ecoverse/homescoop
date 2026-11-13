# Negative proof (wasi-quickjs)

## 0.18.0-1

**Date:** 2026-11-13. slicc-kernel 1.185.0 (the root `package.json` pin)
on Node, `test/node-kernel.mjs` (the cert's `ci` command), which runs the
cert specs on `createNodeKernel()` (sync) and on
`createNodeKernel({ blocking: 'async', emscripten: 'kernel' })` (async),
users `enforce`, with wasm-bash 5.3.0-23, wasm-coreutils 9.12.0-15 and
slicc-jsh 0.64.0. The real build (`scripts/host-run.sh wasi-quickjs`,
`qjs.wasm` sha256 `66a5045c…`, 19 pages of initial memory) passes all
nine runs. Each defect below was built from the same tarball with the
same wasi-sdk and packed into the same `package.tgz`. Recorded failures:

- **Upstream's own `qjs-wasi.wasm` 0.18.0** (the release asset homescoop#2070
  tried, sha256 `2c218412…`): `cwd.mjs` FAIL in both hosts at the first row,
  where `PWD` is the cwd, and `checklist.mjs` FAIL in both at `qjs < file.js`:

  ```text
  AssertionError [ERR_ASSERTION]: PWD is the cwd: rc=0
  {"cwd":"/","tmp":"root-tmp","absTmp":"root-tmp",…,"root":"home,inner,only-in-sub.txt,tmp",…}
  AssertionError [ERR_ASSERTION]: qjs < file.js (0002: a script, not the REPL): rc=124
  QuickJS-ng - Type ".help" for help
  qjs > console.log("hello", 6 * 7, …
  ```

  `tmp/where.txt` in `/home/qjscwd/sub` is `/tmp/where.txt`, `os.getcwd()`
  is `/` and `os.readdir('/')` lists the cwd. `qjs < hello.js` echoes the
  script into the REPL, runs it, and waits at a new prompt until `timeout
  20` ends it (124).

- **Without 0001** (0002 and 0003 applied): `cwd.mjs` FAIL in both hosts as
  above (`"cwd":"/","tmp":"root-tmp"`), and `cwd-node.mjs` FAIL: node's
  `spawnSync('qjs', …, { cwd })` prints `/ root-tmp` instead of
  `/home/qjsnode/sub sub-tmp`. `checklist.mjs` passes: none of its relative
  paths starts with a top-level directory's name.

- **Without 0002** (0001 and 0003): `checklist.mjs` FAIL in both hosts at
  `qjs < file.js` (rc=124, the REPL's echo), as for upstream's build.

- **Without 0003** (0001 and 0002): `limits.mjs` FAIL on the async host at
  the deep-recursion row; the sync host passes it.

  ```text
  AssertionError [ERR_ASSERTION]: deep recursion (0003): rc=70
  RangeError: Maximum call stack size exceeded
      at wasm://wasm/0041e3c6:wasm-function[223]:0x1e1bc
  ```

  The engine's stack overflowed inside the wasm, which ends the process,
  before qjs's 1 MiB limit threw a catchable `RangeError`.

- **A build without the file-read path** (all three patches,
  `js_std_loadFile` returning `null` at once): `checklist.mjs` FAIL in both
  hosts at the `qjs:std` files row:

  ```text
  AssertionError [ERR_ASSERTION]: qjs:std reads and writes by relative and absolute paths: rc=1
  [null,null,null,null]
  TypeError: cannot read property 'length' of null
  ```

## Wrong-output cases (in-spec)

`cert/checklist.mjs` compares whole outputs: every way of handing qjs a
script (`-e`, a file with arguments, `< file`, a pipe, `-`, the caller's
stdin, a module on stdin), lines read from a pipe (20,000 counted and
summed), the bytes `qjs:std` writes by relative and absolute paths as `cat`
reads them back at their physical paths, the exit status and stderr of
`std.exit` and of each kind of failure, and modules that import each other
by `./`, `../` and JSON. `cert/cwd.mjs` runs seven `PWD` values against a
directory that has its own `tmp/` and `home/`, so a build that resolved
relative paths from `/`, trusted `PWD`, or left `/` on the cwd fails it.
`cert/limits.mjs` lists the `qjs:std` and `qjs:os` functions by name both
ways, so a build that gained or lost one (threads, a different libc) fails.
