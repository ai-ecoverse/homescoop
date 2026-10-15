# Negative proof (wasi-gh)

**Date:** 2026-10-13

## Patch removed (`0001-wasip1-slicc-host.patch`)

Pinned source `cli/cli@fc4b137cdef0a6bd28fd461b7cf9c84a5812a8cd` with both
patches reversed, Go 1.27.1, `GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build
-trimpath -o /tmp/gh-neg.wasm ./cmd/gh` (`GOFLAGS=-mod=vendor`). Exit 1. No
`gh.wasm`. The compiler errors are the ones `0001-wasip1-slicc-host.patch`
exists to remove:

```text
# github.com/atotto/clipboard
vendor/github.com/atotto/clipboard/clipboard.go:10:9: undefined: readAll
vendor/github.com/atotto/clipboard/clipboard.go:15:9: undefined: writeAll
# github.com/cli/cli/v2/internal/flock
internal/flock/flock_unix.go:21:20: undefined: syscall.Flock
internal/flock/flock_unix.go:21:47: undefined: syscall.LOCK_EX
internal/flock/flock_unix.go:21:63: undefined: syscall.LOCK_NB
internal/flock/flock_unix.go:23:29: undefined: syscall.EWOULDBLOCK
internal/flock/flock_unix.go:29:15: undefined: syscall.Flock
internal/flock/flock_unix.go:29:42: undefined: syscall.LOCK_UN
# github.com/AlecAivazis/survey/v2/terminal
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:26:17: undefined: syscall.Termios
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:48:43: undefined: syscall.SYS_IOCTL
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:48:81: undefined: ioctlReadTermios
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:53:29: undefined: syscall.ECHO
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:53:44: undefined: syscall.ECHONL
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:53:61: undefined: syscall.ICANON
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:53:78: undefined: syscall.ISIG
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:57:22: undefined: syscall.VMIN
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:58:22: undefined: syscall.VTIME
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:60:43: undefined: syscall.SYS_IOCTL
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:60:43: too many errors
# github.com/cli/cli/v2/internal/telemetry
internal/telemetry/detach_unix.go:11:30: unknown field Setpgid in struct literal of type syscall.SysProcAttr
# github.com/muesli/termenv
vendor/github.com/muesli/termenv/output.go:143:17: o.foregroundColor undefined (type *Output has no field or method foregroundColor, but does have method ForegroundColor)
vendor/github.com/muesli/termenv/output.go:162:17: o.backgroundColor undefined (type *Output has no field or method backgroundColor, but does have method BackgroundColor)
vendor/github.com/muesli/termenv/termenv.go:45:16: output.ColorProfile undefined (type *Output has no field or method ColorProfile)
vendor/github.com/muesli/termenv/termenv.go:103:9: o.ColorProfile undefined (type *Output has no field or method ColorProfile)
# github.com/gdamore/tcell/v2
vendor/github.com/gdamore/tcell/v2/tscreen.go:190:12: t.initialize undefined (type *tScreen has no field or method initialize)
# charm.land/bubbletea/v2
vendor/charm.land/bubbletea/v2/tea.go:698:8: p.listenForResize undefined (type *Program has no field or method listenForResize)
vendor/charm.land/bubbletea/v2/tea.go:780:8: undefined: suspendSupported
vendor/charm.land/bubbletea/v2/tty.go:18:2: undefined: suspendProcess
vendor/charm.land/bubbletea/v2/tty.go:28:11: p.initInput undefined (type *Program has no field or method initInput)
# github.com/in-toto/in-toto-golang/in_toto
vendor/github.com/in-toto/in-toto-golang/in_toto/util_unix.go:9:14: undefined: unix.Access
vendor/github.com/in-toto/in-toto-golang/in_toto/util_unix.go:9:32: undefined: unix.W_OK
```

`0002-wasip1-gh-browser.patch` is not reachable until this build succeeds.
Without its `internal/authflow` hunk, a piped `gh auth login -w` only prints
the URL and does not start `GH_BROWSER`.
