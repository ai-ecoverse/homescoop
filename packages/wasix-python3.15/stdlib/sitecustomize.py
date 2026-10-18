# slicc (homescoop wasix-python): sys.executable for the interpreter, see
# _slicc_site.py. Shipped in the stdlib directory, so it shadows a
# sitecustomize further down sys.path; that one still runs, after this, and
# is what `import sitecustomize` then returns.
import os
import sys

import _slicc_site

_slicc_site.fix()


def _slicc_chain():
    import importlib.machinery
    import importlib.util

    here = os.path.dirname(os.path.abspath(__file__))
    rest = [p for p in sys.path if os.path.abspath(p or ".") != here]
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", rest)
    if spec is None or spec.origin == os.path.abspath(__file__):
        return
    module = importlib.util.module_from_spec(spec)
    ours = sys.modules.get("sitecustomize")
    sys.modules["sitecustomize"] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        if ours is not None:
            sys.modules["sitecustomize"] = ours
        raise


try:
    _slicc_chain()
except Exception as exc:  # as site.py does for a failing sitecustomize
    print(f"Error in sitecustomize; set PYTHONVERBOSE for traceback:\n{type(exc).__name__}: {exc}", file=sys.stderr)
del _slicc_chain
