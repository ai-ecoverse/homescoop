"""slicc (homescoop wasix-python): give the interpreter a sys.executable.

WASI stat() has no permission bits, so CPython's PATH search for argv[0]
(getpath's isxfile) never matches the kernel's /usr/bin commands and
sys.executable stays '' (python -m venv then refuses to run). fix() fills
it in from PATH. It runs twice per start, idempotently: from
site-packages/slicc-executable.pth (base interpreter; a sitecustomize on
PYTHONPATH cannot shadow it) and from the stdlib sitecustomize.py (venvs
without system site-packages, which skip the base .pth files). A venv's own
bin/python gets its path from argv[0] on slicc-kernel >= 1.29.0.
"""
import os
import sys


def fix():
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
