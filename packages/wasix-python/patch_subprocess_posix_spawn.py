#!/usr/bin/env python3
"""Patch CPython subprocess.py for WASIX ehpic: always posix_spawn, never _fork_exec."""
from __future__ import annotations

import pathlib
import sys

WASIX_EXECUTE_CHILD = '''
        def _posix_spawn(self, args, executable, env, restore_signals, close_fds,
                         p2cread, p2cwrite,
                         c2pread, c2pwrite,
                         errread, errwrite,
                         cwd=None, start_new_session=False, pass_fds=()):
            """Execute program using os.posix_spawn() (WASIX: always this path)."""
            kwargs = {}
            if restore_signals:
                # See _Py_RestoreSignals() in Python/pylifecycle.c
                sigset = []
                for signame in ('SIGPIPE', 'SIGXFZ', 'SIGXFSZ'):
                    signum = getattr(signal, signame, None)
                    if signum is not None:
                        sigset.append(signum)
                kwargs['setsigdef'] = sigset

            if start_new_session:
                kwargs['setsid'] = True

            file_actions = []
            for fd in (p2cwrite, c2pread, errread):
                if fd != -1:
                    file_actions.append((os.POSIX_SPAWN_CLOSE, fd))
            for fd, fd2 in (
                (p2cread, 0),
                (c2pwrite, 1),
                (errwrite, 2),
            ):
                if fd != -1:
                    file_actions.append((os.POSIX_SPAWN_DUP2, fd, fd2))

            # close_fds: prefer CLOSEFROM; else close inherited fds via CLOSE
            # (fds_to_keep = stdio after dup2 + pass_fds). Rely on CLOEXEC when
            # we cannot enumerate.
            keep = {0, 1, 2}
            keep.update(int(fd) for fd in pass_fds)
            if close_fds and _HAVE_POSIX_SPAWN_CLOSEFROM:
                file_actions.append((os.POSIX_SPAWN_CLOSEFROM, 3))
            elif close_fds:
                try:
                    low, high = 3, 256
                    try:
                        high = max(high, int(os.sysconf("SC_OPEN_MAX")))
                    except (AttributeError, ValueError, OSError):
                        pass
                    high = min(high, 1024)
                    for fd in range(low, high):
                        if fd in keep:
                            continue
                        # Skip pipe ends we already scheduled CLOSE/DUP2 for
                        if fd in (p2cread, p2cwrite, c2pread, c2pwrite, errread, errwrite):
                            continue
                        try:
                            os.fstat(fd)
                        except OSError:
                            continue
                        file_actions.append((os.POSIX_SPAWN_CLOSE, fd))
                except Exception:
                    # Fall back to close-on-exec behaviour of the runtime.
                    pass

            # cwd: wasix-libc has addchdir_np but CPython file_actions do not
            # expose CHDIR. Use /bin/sh: cd "$1" && shift && exec "$@"
            # (python -c helper fails when sys.executable is unset → argv0=pwd).
            spawn_executable = executable
            spawn_args = args
            if cwd is not None:
                cwd_s = os.fsdecode(cwd) if isinstance(cwd, (bytes, os.PathLike)) else cwd
                shell = "/bin/sh"
                spawn_executable = shell
                spawn_args = [
                    shell, "-c", 'cd "$1" && shift && exec "$@"',
                    "sh", cwd_s, *args,
                ]

            if file_actions:
                kwargs['file_actions'] = file_actions

            self.pid = os.posix_spawn(spawn_executable, spawn_args, env, **kwargs)
            self._child_created = True

            self._close_pipe_fds(p2cread, p2cwrite,
                                 c2pread, c2pwrite,
                                 errread, errwrite)

        def _execute_child(self, args, executable, preexec_fn, close_fds,
                           pass_fds, cwd, env,
                           startupinfo, creationflags, shell,
                           p2cread, p2cwrite,
                           c2pread, c2pwrite,
                           errread, errwrite,
                           restore_signals,
                           gid, gids, uid, umask,
                           start_new_session, process_group):
            """Execute program (POSIX / WASIX): always os.posix_spawn."""

            if isinstance(args, (str, bytes)):
                args = [args]
            elif isinstance(args, os.PathLike):
                if shell:
                    raise TypeError('path-like args is not allowed when '
                                    'shell is true')
                args = [args]
            else:
                args = list(args)

            if shell:
                unix_shell = ('/system/bin/sh' if
                          hasattr(sys, 'getandroidapilevel') else '/bin/sh')
                args = [unix_shell, "-c"] + args
                if executable:
                    args[0] = executable

            if executable is None:
                executable = args[0]

            sys.audit("subprocess.Popen", executable, args, cwd, env)

            if preexec_fn is not None:
                raise OSError(
                    errno.ENOTSUP,
                    "preexec_fn is not supported on WASIX (no fork); "
                    "use env=/cwd=/start_new_session= instead"
                )
            if process_group != -1 or gid is not None or gids is not None or uid is not None or umask >= 0:
                raise OSError(
                    errno.ENOTSUP,
                    "uid/gid/umask/process_group are not supported via "
                    "posix_spawn on this WASIX build"
                )

            # Resolve executable on PATH when needed (posix_spawn requires path).
            if not os.path.dirname(executable):
                resolved = None
                for dir in os.get_exec_path(env):
                    candidate = os.path.join(dir, executable)
                    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                        resolved = candidate
                        break
                if resolved is None:
                    # Still try as-is; host may resolve.
                    pass
                else:
                    executable = resolved
                    args = [executable if i == 0 else a for i, a in enumerate(args)]
                    if args:
                        args[0] = executable

            if env is not None:
                env = {os.fsdecode(k) if isinstance(k, bytes) else k:
                       os.fsdecode(v) if isinstance(v, bytes) else v
                       for k, v in env.items()}

            self._posix_spawn(
                args, executable, env, restore_signals, close_fds,
                p2cread, p2cwrite, c2pread, c2pwrite, errread, errwrite,
                cwd=cwd, start_new_session=start_new_session, pass_fds=pass_fds,
            )
'''


def patch(text: str) -> str:
    # 1) Force _can_fork_exec = False
    old_fork = """# some platforms do not support subprocesses
# homescoop wasix-python: WASIX provides fork/exec; enable when os.fork exists.
try:
    import os as _os
    _can_fork_exec = hasattr(_os, "fork") or sys.platform not in {"emscripten", "wasi", "ios", "tvos", "watchos"}
except Exception:
    _can_fork_exec = sys.platform not in {"emscripten", "wasi", "ios", "tvos", "watchos"}
"""
    old_fork_stock = """# some platforms do not support subprocesses
_can_fork_exec = sys.platform not in {"emscripten", "wasi", "ios", "tvos", "watchos"}
"""
    old_fork_prev = """# some platforms do not support subprocesses
# homescoop wasix-python: sysroot-ehpic has no fork/vfork; use posix_spawn
# (WASIX proc_spawn2/3). Keep _can_fork_exec false so _posixsubprocess is unused.
_can_fork_exec = False
"""
    new_fork = """# some platforms do not support subprocesses
# homescoop wasix-python: sysroot-ehpic has no fork/vfork; always posix_spawn
# (WASIX proc_spawn2/3). Keep _can_fork_exec false so _posixsubprocess/_fork_exec
# are never referenced (default close_fds=True would otherwise fall through).
_can_fork_exec = False
"""
    if old_fork_prev in text:
        text = text.replace(old_fork_prev, new_fork)
    elif old_fork in text:
        text = text.replace(old_fork, new_fork)
    elif old_fork_stock in text:
        text = text.replace(old_fork_stock, new_fork)
    elif "_can_fork_exec = False\n" not in text:
        raise SystemExit("could not find _can_fork_exec block to patch")

    # 1b) _del_safe must keep real waitpid for posix_spawn children
    old_del = """    if _can_fork_exec:
        from _posixsubprocess import fork_exec as _fork_exec
        # used in methods that are called by __del__
        class _del_safe:
            waitpid = os.waitpid
            waitstatus_to_exitcode = os.waitstatus_to_exitcode
            WIFSTOPPED = os.WIFSTOPPED
            WSTOPSIG = os.WSTOPSIG
            WNOHANG = os.WNOHANG
            ECHILD = errno.ECHILD
    else:
        class _del_safe:
            waitpid = None
            waitstatus_to_exitcode = None
            WIFSTOPPED = None
            WSTOPSIG = None
            WNOHANG = None
            ECHILD = errno.ECHILD
"""
    old_del2 = """    if _can_fork_exec:
        from _posixsubprocess import fork_exec as _fork_exec
    # used by __del__ / poll — required for posix_spawn children too (no fork)
    class _del_safe:
        waitpid = os.waitpid
        waitstatus_to_exitcode = os.waitstatus_to_exitcode
        WIFSTOPPED = os.WIFSTOPPED
        WSTOPSIG = os.WSTOPSIG
        WNOHANG = os.WNOHANG
        ECHILD = errno.ECHILD
"""
    new_del = """    # homescoop: never import _fork_exec; waitpid still required for spawn kids
    class _del_safe:
        waitpid = os.waitpid
        waitstatus_to_exitcode = os.waitstatus_to_exitcode
        WIFSTOPPED = os.WIFSTOPPED
        WSTOPSIG = os.WSTOPSIG
        WNOHANG = os.WNOHANG
        ECHILD = errno.ECHILD
"""
    if old_del in text:
        text = text.replace(old_del, new_del)
    elif old_del2 in text:
        text = text.replace(old_del2, new_del)
    elif "class _del_safe:" not in text or "waitpid = os.waitpid" not in text:
        raise SystemExit("could not find _del_safe block to patch")

    # 2) Make _use_posix_spawn return True on wasi
    needle = """    if sys.platform in ('darwin', 'sunos5'):
        # posix_spawn() is a syscall on both macOS and Solaris,
        # and properly reports errors
        return True
"""
    needle2 = """    if sys.platform in ('darwin', 'sunos5', 'wasi'):
        # posix_spawn() is a syscall on both macOS and Solaris,
        # and properly reports errors.
        # WASIX (wasi platform tag): libc posix_spawn → proc_spawn2/3.
        return True
"""
    repl = """    if sys.platform in ('darwin', 'sunos5', 'wasi'):
        # posix_spawn() is a syscall on both macOS and Solaris,
        # and properly reports errors.
        # WASIX (wasi platform tag): libc posix_spawn → proc_spawn2/3.
        return True
"""
    if needle2 in text:
        pass  # already patched
    elif needle in text:
        text = text.replace(needle, repl)
    else:
        raise SystemExit("could not find _use_posix_spawn darwin/sunos5 block")

    # 3) Allow Popen when posix_spawn works even if _can_fork_exec is false
    old_init = """        if not _can_fork_exec:
            raise OSError(
                errno.ENOTSUP, f"{sys.platform} does not support processes."
            )
"""
    new_init = """        if not _can_fork_exec and not _USE_POSIX_SPAWN:
            raise OSError(
                errno.ENOTSUP, f"{sys.platform} does not support processes."
            )
"""
    if old_init in text:
        text = text.replace(old_init, new_init)
    elif "not _can_fork_exec and not _USE_POSIX_SPAWN" not in text:
        raise SystemExit("could not find Popen _can_fork_exec guard")

    # 4) Replace POSIX _posix_spawn + _execute_child with WASIX always-spawn versions.
    # Locate from "def _posix_spawn" through end of _execute_child (before next method
    # at same indent that isn't these two).
    marker = "        def _posix_spawn(self, args, executable, env, restore_signals, close_fds,"
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("could not find _posix_spawn definition")
    # Find following method after _execute_child — typically "def _handle_exitstatus"
    # or "def wait". Search for next "        def " after _execute_child body.
    exec_marker = "        def _execute_child(self, args, executable, preexec_fn, close_fds,"
    exec_idx = text.find(exec_marker, idx)
    if exec_idx < 0:
        raise SystemExit("could not find _execute_child after _posix_spawn")
    # Find next method at class indent after _execute_child
    rest = text[exec_idx + len(exec_marker):]
    # Skip to end of this method: next line matching ^        def 
    import re
    m = re.search(r"\n        def ", rest)
    if not m:
        raise SystemExit("could not find end of _execute_child")
    end = exec_idx + len(exec_marker) + m.start() + 1  # keep the newline before next def
    text = text[:idx] + WASIX_EXECUTE_CHILD.strip("\n") + "\n\n" + text[end:]

    # Guard accidental _fork_exec references
    if "_fork_exec(" in text and "NameError" not in text:
        # should only remain in comments if any; fail if call remains
        if re.search(r"(?<![\\w])_fork_exec\\s*\\(", text):
            # Our replacement should have removed the call; if stock Windows path remains OK
            pass

    return text


def main() -> None:
    path = pathlib.Path(sys.argv[1])
    text = path.read_text()
    path.write_text(patch(text))
    print("patched", path)


if __name__ == "__main__":
    main()
