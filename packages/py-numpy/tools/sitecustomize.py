"""Force WASIX target sysconfig when building numpy extensions on the host."""
import sysconfig
import platform

_INC = "/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python/package/include/python3.14"
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
    "LIBDIR": "/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python/package/lib",
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
    if name == "include":
        return _INC
    if name == "platinclude":
        return _INC
    return _orig_get_path(name, *a, **k)

sysconfig.get_config_var = get_config_var
sysconfig.get_config_vars = get_config_vars
sysconfig.get_platform = get_platform
sysconfig.get_path = get_path
platform.machine = lambda: "wasm32"
