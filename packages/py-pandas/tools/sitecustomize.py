"""Force WASIX target sysconfig + wasm numpy include when cross-building pandas.

Set env before build:
  HOMESCOOP_ROOT, WASIX_PYTHON_INC, WASIX_NUMPY_INC (optional overrides)
"""
import os
import sysconfig
import platform

_ROOT = os.environ.get("HOMESCOOP_ROOT", "")
_INC = os.environ.get(
    "WASIX_PYTHON_INC",
    f"{_ROOT}/packages/wasix-python/package/include/python3.14",
)
_NPY_INC = os.environ.get(
    "WASIX_NUMPY_INC",
    f"{_ROOT}/packages/py-numpy/package/lib/python3.14/site-packages/numpy/_core/include",
)
_LIB = os.environ.get(
    "WASIX_PYTHON_LIB",
    f"{_ROOT}/packages/wasix-python/package/lib",
)
_OVERRIDES = {
    "SOABI": "cpython-314-wasm32-wasix",
    "EXT_SUFFIX": ".cpython-314-wasm32-wasix.so",
    "INCLUDEPY": _INC,
    "CONFINCLUDEPY": _INC,
    "CC": "wasixcc",
    "CXX": "wasixcc++",
    "LDSHARED": "wasixcc -shared",
    "BLDSHARED": "wasixcc -shared",
    "LDCXXSHARED": "wasixcc++ -shared",
    "HOST_GNU_TYPE": "wasm32-unknown-wasix",
    "MULTIARCH": "wasm32-wasix",
    "Py_ENABLE_SHARED": "0",
    "LIBDIR": _LIB,
    "LDLIBRARY": "libpython3.14.a",
    "LIBRARY": "libpython3.14.a",
    "GNULD": "yes",
    "SHLIB_SUFFIX": ".so",
    "SIZEOF_VOID_P": "4",
    "SIZEOF_SIZE_T": "4",
    "SIZEOF_LONG": "4",
    "SIZEOF_TIME_T": "8",
}

_orig_get = sysconfig.get_config_var
_orig_get_config_vars = sysconfig.get_config_vars
_orig_get_platform = sysconfig.get_platform
_orig_get_path = sysconfig.get_path

def get_config_var(name):
    if name in _OVERRIDES:
        return _OVERRIDES[name]
    return _orig_get(name)

def get_config_vars(*args):
    if not args:
        d = dict(_orig_get_config_vars())
        d.update(_OVERRIDES)
        return d
    return [get_config_var(a) for a in args]

def get_platform():
    return "wasix_wasm32"

def get_path(name, *a, **k):
    if name in ("include", "platinclude"):
        return _INC
    return _orig_get_path(name, *a, **k)

sysconfig.get_config_var = get_config_var
sysconfig.get_config_vars = get_config_vars
sysconfig.get_platform = get_platform
sysconfig.get_path = get_path
platform.machine = lambda: "wasm32"

import builtins
_real_import = builtins.__import__

def _import(name, globals=None, locals=None, fromlist=(), level=0):
    mod = _real_import(name, globals, locals, fromlist, level)
    if name == "numpy" or name.split(".")[0] == "numpy":
        root = __import__("sys").modules.get("numpy")
        if root is not None:
            try:
                root.get_include = lambda: _NPY_INC
            except Exception:
                pass
    return mod

builtins.__import__ = _import
