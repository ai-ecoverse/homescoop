#!/usr/bin/env python3
"""cffi-emit.py: run a cffi ffibuilder on the build host and write its C source.

For homescoop recipes that cross-build cffi API-mode (out-of-line) extensions
for wasix-python (scripts/cffi-wasix.sh; packages/py-cffi/package/README.md).
It needs no compiled cffi on the host: the pure-Python cffi package (from the
pinned sdist's src/) runs on its ctypes backend, which is enough to parse the
cdef and generate the C (recompiler.make_c_source). The generated C is the
same whichever backend parsed the cdef, and the C compiler checks every size
and offset against the target's headers when the module is compiled.

Usage:
  python3 cffi-emit.py --path <dir> [--path <dir> ...] [--chdir <dir>]
                       <script.py>[:<var>] <out.c>

--path dirs go first on sys.path: cffi's src/, pycparser, and whatever the
build script imports. <var> is the FFI object in the script (cffi_modules
style, "src/build.py:ffi"); without it the script's only cffi.FFI object at
module level is used. The script must have called ffi.set_source().
"""
import argparse
import os
import runpy
import sys


def ctypes_backend_module():
    """A stand-in `_cffi_backend` for the host: cffi's ctypes backend."""
    import types

    import cffi
    from cffi.backend_ctypes import CTypesBackend

    backend = CTypesBackend()
    mod = types.ModuleType("_cffi_backend")
    mod.__dict__.update({k: getattr(backend, k) for k in dir(backend) if not k.startswith("__")})
    mod.__version__ = cffi.__version__
    mod.__homescoop_ctypes_backend__ = backend
    return mod, backend


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--path", action="append", default=[], help="prepend to sys.path")
    ap.add_argument("--chdir", help="run the script from this directory")
    ap.add_argument("script", help="<script.py>[:<var>]")
    ap.add_argument("out", help="the C file to write")
    a = ap.parse_args(argv)

    for p in reversed(a.path):
        sys.path.insert(0, os.path.abspath(p))
    out = os.path.abspath(a.out)
    script, _, var = a.script.partition(":")
    script = os.path.abspath(script)

    import cffi

    mod, backend = ctypes_backend_module()
    if "_cffi_backend" in sys.modules:
        sys.exit("cffi-emit: a compiled _cffi_backend is already imported; run on a python without cffi")
    sys.modules["_cffi_backend"] = mod
    real_init = cffi.FFI.__init__

    def init(self, backend_arg=None):
        real_init(self, backend if backend_arg is None or backend_arg is mod else backend_arg)

    cffi.FFI.__init__ = init

    if a.chdir:
        os.chdir(a.chdir)
    sys.argv = [script]
    sys.path.insert(0, os.path.dirname(script))
    ns = runpy.run_path(script, run_name="__cffi_emit__")
    if var:
        ffi = ns.get(var)
        if not isinstance(ffi, cffi.FFI):
            sys.exit(f"cffi-emit: {a.script}: {var} is not a cffi.FFI ({type(ffi).__name__})")
    else:
        found = [v for v in ns.values() if isinstance(v, cffi.FFI)]
        if len(found) != 1:
            sys.exit(f"cffi-emit: {script} has {len(found)} cffi.FFI objects at module level; name one with :<var>")
        ffi = found[0]
    if getattr(ffi, "_assigned_source", None) is None:
        sys.exit(f"cffi-emit: {a.script}: set_source() was not called")
    module_name = ffi._assigned_source[0]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    ffi.emit_c_code(out)
    print(f"cffi-emit: {module_name} (cffi {cffi.__version__}, ctypes backend on CPython {sys.version.split()[0]}) -> {out}")


if __name__ == "__main__":
    main()
