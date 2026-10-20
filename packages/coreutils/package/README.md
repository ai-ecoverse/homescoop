# `@ai-ecoverse/wasm-coreutils`

GNU coreutils (single-binary) for slicc.

```bash
pnpm add -g @ai-ecoverse/wasm-coreutils
```

## Time zones and the environment (9.12.0-12)

`date`, `touch`, `ls` and the rest honour `TZ`:
- **POSIX rules:** `EST5EDT`, `JST-9`, `UTC0`, `<+0330>-3:30`, with a rule
  such as `,M3.2.0,M11.1.0`, or the US rules when there's none.
- **IANA names:** `America/New_York`, `Europe/Berlin`, from the browser's
  time zone data.
- **Defaults:** an empty or unknown `TZ` is UTC, and `date -u` is UTC. With
  no `TZ` at all, the browser's own time zone applies, as before.

`env -i` and `env -u` leave exactly the environment they say. Before, the
program filled in Emscripten's placeholders (`USER=web_user`, `PATH=/`,
`HOME=/home/web_user`, `LANG`).

## `uname` (9.12.0-7)

`uname` asks slicc-kernel through the import `env.__syscall_uname`
(slicc-kernel#625) instead of Emscripten's built-in answer. A kernel that
answers it gives `Linux`, its hostname, the release in
`/proc/sys/kernel/osrelease` (`6.0.0-slicc`) and `wasm32`; older kernels
leave the default, which is what 9.12.0-6 always printed: `Emscripten`,
`emscripten`, `4.0.23`, `#1`, `wasm32`.

The wasm no longer carries the build machine's emsdk cache path in its debug
strings (homescoop#358 maps it to `/emsdk`), so a rebuild elsewhere gives the
same bytes.

## Running by path (9.12.0-6)

`bin/coreutils` (the Emscripten glue the `slicc.commands` entries name) is
mode 0755 in the package, so it can be run by path under slicc-kernel's
users enforce. 9.12.0-5 shipped it 0644, which gave `Permission denied`
(126).

## Hard links (9.12.0-6)

`ln`, `ln -f`, `cp -l` and `link` ask slicc-kernel to make the link
(`__syscall_linkat`, slicc-kernel#563). On slicc-kernel ≥ 1.90.0 they work in
mounts that have hard links (tmpfs), and give `Too many links` on the OPFS
root and `Cross-device link` across mounts. On older kernels every hard link
is `Too many links`, as in 9.12.0-5, where the call never reached the kernel.

## Device numbers (9.12.0-6)

`stat -c '%t:%T'` and `ls -l` show a device's major and minor numbers as
slicc-kernel reports them (`/dev/null` is `1, 3`). Up to 9.12.0-5 Emscripten's
`statx()` dropped them: `stat` said `0:0` and `ls -l` printed numbers left on
the stack (homescoop#324).

## Users (9.12.0-5, slicc-kernel ≥ 1.44.0)

`id`, `whoami`, `groups`, `logname`, `ls -l` and `stat` name users and groups
from slicc-kernel's process credentials and its `/etc/passwd` and
`/etc/group`:
- root (the kernel's default) is `uid=0(root)`;
- a user added with `kernel.users.add` gets its own uid, its groups (for
  example `users`) and its name.

There is no fallback: on an older kernel the ids are -1. File owners are the
kernel's, and 1.44.0 reports uid 1000 for every file.

