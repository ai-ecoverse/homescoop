# `@ai-ecoverse/wasm-rsync`

[rsync](https://rsync.samba.org/) 3.5.1 for [slicc](https://github.com/ai-ecoverse/slicc)'s
wasm realm. Local copies only for now:

```bash
pnpm add -g @ai-ecoverse/wasm-rsync
rsync -a --delete src/ dst/
rsync -av --dry-run --exclude='*.log' src/ dst/
rsync -a -c --itemize-changes --stats src/ dst/
```

A local rsync forks a receiver and a generator that talk to the sender over
pipes; on slicc-kernel each is a real process (Emscripten + Asyncify fork).
rsync:// works over the kernel's sockets (3.4.4-3): `rsync --daemon` on a
kernel port, and clients to it or, with seven's tailnet, to tailnet names.
Remote shells (`-e ssh`) need an ssh client in the realm. Daemon modules with
`auth users` need `RSYNC_PASSWORD` or `--password-file`: there is no
interactive password prompt (rsync gets an empty password and the daemon
refuses at once, rc 5).

Built without OpenSSL, xxhash, zstd, lz4, iconv, IDN, ACLs or xattrs (bundled zlib
and popt). Error messages print Emscripten's errno numbers (`No such file or
directory (44)` where Linux prints `(2)`).

**From 3.4.4-2 on, rsync requires slicc-kernel ≥ 1.29.2.** `-a` preserves symlinks' own
mtimes, as upstream rsync does, through `utimensat(AT_SYMLINK_NOFOLLOW)`.
Older kernels followed the link there (slicc-kernel#170) and stamped the
link's mtime onto its target, even a file in the source tree; stay on
3.4.4-1 below 1.29.2, which never sets link times (`-J`).

On a hostfs folder (a folder of the user's machine mounted through
slicc-node), the host cannot set a symlink's own time, and on a macOS host
not its mode either. rsync still copies files, links and link targets
correctly (targets keep their times), but it warns (`failed to set times on
…: Not supported`) and exits 23, and a re-run itemizes those links again
(`.L..tp`).


Since 3.4.4-4 rsync uses slicc-kernel's process credentials: as root, `-a`
keeps owners and groups (`-o -g`), as on Linux; any other user keeps a group
only if it belongs to it. 3.4.4-3 and older saw Emscripten's fixed ids, so
root's `rsync -a` did not keep owners.

On slicc-kernel ≥ 1.73.3 a user's `rsync -a` of symlinks exits 0 (slicc-kernel#449:
older kernels said a just-created link was 0:0, so the chgrp failed, rc 23),
and the destination's top directory keeps the source's mtime (1.36.0-1.73.2
did not, so a second `rsync -a -i` itemized `.d..t...... ./`).

## Signals

SIGINT, SIGTERM and SIGHUP (Ctrl-C, `kill`, `timeout`) end rsync with exit
code 20 and `rsync error: received SIGINT, SIGTERM, or SIGHUP (code 20)`, as on
Linux: rsync catches them, cleans up and exits. It never ends by the signal
itself. The temporary file of the transfer in progress (`.name.XXXXXX`) is
removed; with `--partial` or `--inplace` the partly copied file is kept under its
own name, and the next run with the same option uses it as the basis
instead of starting over. Since 3.4.4-5 rsync also links
the slicc shims' self-kill, which ends a program by the signal it sends itself
(`kill -TERM` of its own pid); rsync never takes that path.

## 3.5.1-1

Upstream 3.5.1: protocol 33, and the path-handling security fixes introduced in 3.5.0 (a
per-component resolver that refuses planted symlinks; see upstream's NEWS).
rsync now waits with poll(), which the slicc shims make wait in the kernel.

## Symlinks in the destination (3.5.x)

The secure path resolver introduced in 3.5.0 (upstream NEWS, "BEHAVIOR
CHANGES") changes two things you may hit, here as on Linux:

- **A destination directory reached through a symlink another user owns is
  refused.** If eve's `/tmp/evelink` points to a directory you may write to,
  `rsync -a src /tmp/evelink/` fails with rc 3: `refusing to follow a symlink
  owned by an untrusted user; use --insecure-links …`, then `change_dir#1
  "/tmp/evelink/" failed`. Nothing is copied. 3.4.x followed the link.
- **`-K` (`--keep-dirlinks`) refuses a destination dirlink whose target is
  absolute or outside the destination tree**: `Symbolic link loop`, rc 23,
  and nothing is written through it. 3.4.x wrote through it. A relative
  dirlink to a directory inside the destination still works.

What counts is who owns the link, not who runs rsync: links you own, and
links root owns, are followed as before, while root is refused through eve's
link too. `--insecure-links` (introduced in 3.5.0) restores the old behaviour for a
run that trusts those links.

## Daemon: client names (3.5.1-3)

`rsync --daemon` names its clients by reverse lookup (`reverse lookup = yes`,
the default). From 3.5.1-3 that lookup answers from the kernel's
`/etc/hosts`: a loopback client is `localhost` (`connect from localhost
(127.0.0.1)` in the log), so `hosts allow = localhost` and the like match by
name. Other addresses have no name (`connect from UNKNOWN (…)`); no query
goes to the tailnet or any DNS server, so `hosts allow` / `hosts deny` for
them takes addresses (`100.64.0.0/10`). Before 3.5.1-3 every client was
`UNKNOWN`, after a `name lookup failed for 127.0.0.1` line, and only
addresses matched; `reverse lookup = no` still skips the lookup.

## 3.5.1-6

The README no longer names a cert kernel, which went stale whenever `cert/meta.json` moved (homescoop#847). The cert record is the source of truth. The `-c` cert row pins the directory times too (homescoop#969).
