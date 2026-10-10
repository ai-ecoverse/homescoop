"""slicc (homescoop wasix-python): give the interpreter a sys.executable.

WASI stat() has no permission bits, so CPython's PATH search for argv[0]
(getpath's isxfile) never matches the kernel's /usr/bin commands and
sys.executable stays '' (python -m venv then refuses to run). fix() fills
it in from PATH. It runs twice per start, idempotently: from
site-packages/slicc-executable.pth (base interpreter; a sitecustomize on
PYTHONPATH cannot shadow it) and from the stdlib sitecustomize.py (venvs
without system site-packages, which skip the base .pth files). A venv's own
bin/python gets its path from argv[0] on slicc-kernel >= 1.29.0.

Also: WASIX dlopen(NULL) returns handle 0 for the main PIE (slicc-kernel's
linker uses 0 = main), but POSIX treats a NULL return as failure — so
ctypes' PyDLL(None) / CDLL(None) raise OSError. Until the kernel returns a
non-zero main handle (slicc-kernel#306 follow-up), fix() maps dlopen(None)
to bin/python.wasm under sys.base_prefix.
"""
import os
import sys


def fix():
    _fix_executable()
    _fix_ctypes_dlopen()


def _fix_executable():
    if sys.executable:
        return
    argv0 = sys.orig_argv[0] if sys.orig_argv else ""
    name = os.path.basename(argv0) or "python3"
    for d in os.environ.get("PATH", "/usr/bin:/bin").split(os.pathsep):
        p = os.path.abspath(os.path.join(d or ".", name))
        if os.path.isfile(p):
            sys.executable = p
            if not getattr(sys, "_base_executable", ""):
                sys._base_executable = p
            return


def _fix_ctypes_dlopen():
    try:
        import _ctypes
    except ImportError:
        return
    if getattr(_ctypes, "_slicc_dlopen_fixed", False):
        return
    wasm = os.path.join(sys.base_prefix, "bin", "python.wasm")
    if not os.path.isfile(wasm):
        wasm = os.path.join(sys.prefix, "bin", "python.wasm")
    if not os.path.isfile(wasm):
        return
    real = _ctypes.dlopen

    def dlopen(name, mode=0, _real=real, _wasm=wasm):
        if name is None:
            name = _wasm
        return _real(name, mode)

    _ctypes.dlopen = dlopen
    _ctypes._slicc_dlopen_fixed = True
