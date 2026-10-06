# wasm-screen 5.0.1-5 (next)

Emscripten + asyncify fork. SLICC PR **#3733** (pseudo-terminals) has merged.
libc includes musl `passwd/` (reads `/etc/passwd` + `/etc/group` from VFS).
`slicc_libc_gaps` strong set*id/setgroups: succeed for uid/gid 1000, else EPERM.
Linked `netfork` profile: `slicc_socket` (AF_UNIX SOCK_STREAM) + `slicc_select` +
`__syscall_pause` (SLICC #3740).
`slicc_sig_mask` rebuilt against host emsdk musl (`sizeof(sigaction)==140`);
stale stride-20 objs made every disposition bit garbage (attacher SIGHUP → Hangup).

## Configure picks (this build)
```
Configuration:

 PAM support: .............................. no
 telnet support: ........................... no
 utmp support: ............................. no
 global socket directory: .................. no

 system screenrc location: ................. /etc/screenrc
 pty mode: ................................. 0622
 pty group: ................................ 0
 pty on read only file system: ............. no

!!! WARNING !!!
YOU ARE DISABLING PAM SUPPORT!
FOR screen TO WORK IT WILL NEED TO RUN AS SUID root BINARY
THIS CONFIGURATION IS _HIGHLY_ NOT RECOMMENDED!
!!! WARNING !!!
--- config.h highlights ---
/* #undef ENABLE_PAM */
/* #undef ENABLE_TELNET */
/* #undef ENABLE_UTMP */
#define HAVE_OPENPTY 1
#define PTY_GROUP 0
#define PTY_MODE 0622
/* #undef SOCKET_DIR */
#define SYSTEM_SCREENRC "/etc/screenrc"
--- LIBS ---
LIBS = -lncursesw 
```

## Smoke (host)
```sh
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs packages/screen/package/bin/screen -- -v
SMOKE_ENV=SCREENDIR=/tmp/screens,HOME=/tmp,TERM=xterm-256color \
  SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs packages/screen/package/bin/screen -- -dmS test sleep 2
```
Browser: multi-window (^A c / ^A n / ^A "); clean frontend exit on backend SIG_BYE
(not `[screen is terminating]` + Hangup). `screen -ls` may be empty.
