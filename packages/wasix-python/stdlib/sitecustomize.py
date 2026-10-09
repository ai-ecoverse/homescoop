# slicc (homescoop wasix-python): fill in sys.executable when getpath could
# not. WASI stat() has no permission bits, so CPython's PATH search for
# argv[0] (isxfile) never matches the kernel's /usr/bin commands and
# sys.executable stays '' (python -m venv then refuses to run). A venv's
# python is found from argv[0] once slicc-kernel passes the invoked path
# (slicc-kernel#168); this only covers the base interpreter.
#
# Shipped in the stdlib directory, so it shadows a sitecustomize further
# down sys.path; that one is still run, after this.
import os
import sys


def _slicc_executable():
    if sys.executable:
        return
    argv0 = sys.orig_argv[0] if sys.orig_argv else ""
    name = os.path.basename(argv0) or "python3"
    for d in os.environ.get("PATH", "/usr/bin:/bin").split(os.pathsep):
        p = os.path.join(d or ".", name)
        if os.path.isfile(p):
            sys.executable = p
            if not getattr(sys, "_base_executable", ""):
                sys._base_executable = p
            return


def _slicc_chain():
    import importlib.machinery
    import importlib.util

    here = os.path.dirname(os.path.abspath(__file__))
    rest = [p for p in sys.path if os.path.abspath(p or ".") != here]
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", rest)
    if spec is None or spec.origin == os.path.abspath(__file__):
        return
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


_slicc_executable()
try:
    _slicc_chain()
except Exception as exc:  # as site.py does for a failing sitecustomize
    print(f"Error in sitecustomize; set PYTHONVERBOSE for traceback:\n{type(exc).__name__}: {exc}", file=sys.stderr)
del _slicc_executable, _slicc_chain
