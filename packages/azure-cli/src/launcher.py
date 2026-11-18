#!/usr/bin/env python3
"""az for slicc: upstream's launcher, in Python (homescoop#2112).

Upstream's az is a shell script that runs `python -Im azure.cli "$@"` with the
Python its package bundles. This script does the same on wasix-python, the
interpreter it runs on, so the command needs no shell, with the package's
own tree (lib/azure-cli, the closure upstream pins) as the only place Python
packages come from.

What it does:
  - sys.path is the standard library and lib/azure-cli, as under python -S:
    the site-packages directories (wasix-python's, py-* packages', a user's)
    are taken off, and any module a .pth there already imported is dropped,
    so az runs on its pinned closure and nothing installed beside it shadows
    a module of it. AZURE_CLI_SITEPACKAGES=1 keeps them on sys.path, after
    lib/azure-cli (az's own modules still win).
  - The kernel's proxy terminates TLS with its own CA, which it names in
    SSL_CERT_FILE. requests (azure-core's transport, and MSAL's) ignores
    SSL_CERT_FILE and trusts certifi unless REQUESTS_CA_BUNDLE says
    otherwise, so REQUESTS_CA_BUNDLE defaults to SSL_CERT_FILE when that file
    exists.
  - Defaults for slicc, each only when the user's az config ($AZURE_CONFIG_DIR/
    config, ~/.azure/config) and environment don't set it, so `az config set`
    still wins: core.collect_telemetry=no (telemetry uploads from a second
    python, and needs psutil), core.survey_message=no, and
    extension.use_dynamic_install=no (a command from an extension says which
    extension to add instead of installing one).
    core.first_run=yes too: az's first-run welcome says the CLI collects
    usage data, which with telemetry off isn't so.
  - core.encrypt_token_cache=false whatever the config says, unless the
    environment sets AZURE_CORE_ENCRYPT_TOKEN_CACHE: an encrypted MSAL token
    cache needs a keyring (DPAPI, Keychain, libsecret), which wasix has none
    of, so the cache is plain JSON in ~/.azure (upstream's Linux default).
  - Native code comes from homescoop's py-* npm packages that this package
    depends on (package.json: py-cryptography, py-pynacl, py-bcrypt,
    py-pyopenssl, py-cffi, py-pycparser), and only from them: each one is
    looked up as Node would from this package's own directory (npm's flat
    node_modules, pnpm's store, a nested copy), and its site-packages goes on
    sys.path after lib/azure-cli and the standard library when it is the
    exact version package.json pins, built for this python (its
    slicc.python.requires abi and platform, and the wasix-python it resolves
    to is this one, the rule wasix-python's own py-* discovery has), and the
    py-* packages it depends on resolve to the same copies az takes. Nothing
    else from site-packages comes back: a py-* or pip-installed package
    beside az still can't shadow one of its modules, nor stand in for one of
    these. AZURE_CLI_SITEPACKAGES=1 adds the rest after them.
  - What's missing fails cleanly: psutil (no wasix build; az imports it in a
    try), and a py-* package that isn't there or was refused. An import that
    nothing on sys.path answers raises a ModuleNotFoundError that is also an
    az error, so az prints one ERROR line that names the module, the npm
    package and why, and exits 1, instead of an "unexpected error"
    traceback. Code that tries the import and falls back (az's psutil use,
    PyJWT's cryptography) still catches it.
  - A closed stdout ends az quietly with status 141, as SIGPIPE ends a C
    program: `az vm list --help | head` printed an "unexpected error"
    traceback for the BrokenPipeError (upstream does too). Only writes to
    stdout do this; a socket's EPIPE stays an exception that requests
    retries.
  - SyntaxWarnings are off: nothing here is precompiled (the tree is the same
    for every Python), so each run compiles what it imports, and some of the
    SDKs' docstrings would warn on every run, not once as with a __pycache__.
"""
import configparser
import json
import os
import runpy
import sys

PACKAGE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
SITE = os.path.join(PACKAGE, "lib", "azure-cli")
# (section, option, value): AZURE_<SECTION>_<OPTION>, as knack reads them.
DEFAULTS = (
    ("core", "collect_telemetry", "no"),
    ("core", "survey_message", "no"),
    ("extension", "use_dynamic_install", "no"),
    ("core", "first_run", "yes"),
)
# The top-level modules of upstream's closure that are native code (or need
# it), and the npm package that has each; None: none has it.
NATIVE = {
    "cryptography": "@ai-ecoverse/py-cryptography",
    "OpenSSL": "@ai-ecoverse/py-pyopenssl",
    "nacl": "@ai-ecoverse/py-pynacl",
    "bcrypt": "@ai-ecoverse/py-bcrypt",
    "cffi": "@ai-ecoverse/py-cffi",
    "_cffi_backend": "@ai-ecoverse/py-cffi",
    "pycparser": "@ai-ecoverse/py-pycparser",
    "psutil": None,
}
PYTHON = "@ai-ecoverse/wasix-python"
# npm package -> why az didn't take it (own_packages()).
REFUSED = {}
README = "https://github.com/ai-ecoverse/homescoop/tree/main/packages/azure-cli/package#whats-not-available"


class QuietPipe:
    """sys.stdout, except that a write to a closed pipe exits with 141."""

    def __init__(self, stream):
        self._stream = stream

    def __getattr__(self, name):
        return getattr(self._stream, name)

    def _closed(self):
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), self._stream.fileno())
        except OSError:
            pass
        os._exit(141)

    def write(self, text):
        try:
            return self._stream.write(text)
        except BrokenPipeError:
            self._closed()

    def flush(self):
        try:
            return self._stream.flush()
        except BrokenPipeError:
            self._closed()


class NativeFinder:
    """Last on sys.meta_path: answers the NATIVE imports nothing else found."""

    @staticmethod
    def find_spec(fullname, path=None, target=None):
        top = fullname.partition(".")[0]
        if top not in NATIVE:
            return None
        npm = NATIVE[top]
        if npm is None:
            what = f"{top} (native code), which has no WASIX build; @ai-ecoverse/azure-cli doesn't include it"
            hint = f"Commands that need it don't run in slicc; see {README}"
        elif npm in REFUSED:
            what = f"{top}, from {npm}, which az couldn't use: {REFUSED[npm]}"
            hint = f"Install @ai-ecoverse/azure-cli again, so that the py-* packages it depends on are the ones it pins; see {README}"
        else:
            return None  # its package is on sys.path: a plain ModuleNotFoundError
        from azure.cli.core.azclierror import UserFault

        class NativeModuleUnavailable(ModuleNotFoundError, UserFault):
            def __init__(self, msg, name):
                UserFault.__init__(self, msg, hint)
                self.msg = msg
                self.name = name

        raise NativeModuleUnavailable(f"This command needs {what} (No module named '{fullname}').", fullname)


def manifest(pkgdir):
    try:
        with open(os.path.join(pkgdir, "package.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) else None


def resolve(start, name):
    """Node's lookup of the package `name` from the real directory `start`."""
    d = start
    while True:
        if os.path.basename(d) != "node_modules":
            cand = os.path.join(d, "node_modules", *name.split("/"))
            if os.path.isfile(os.path.join(cand, "package.json")):
                return os.path.realpath(cand)
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def in_range(version, spec):
    """A py-* package's wasix-python range, ">=X.Y.Z-N <X.Y.Z+1" (homescoop#702)."""
    if not isinstance(spec, str) or not isinstance(version, str) or not spec.startswith(">="):
        return False
    low, _, high = spec[2:].partition(" <")
    try:
        base, _, n = low.partition("-")
        vbase, _, vn = version.partition("-")
        x, y, z = (int(p) for p in base.split("."))
        if tuple(int(p) for p in high.split(".")) != (x, y, z + 1) or tuple(int(p) for p in vbase.split(".")) != (x, y, z):
            return False
        return not vn or int(vn) >= int(n)
    except ValueError:
        return False


def own_packages():
    """The site-packages of the py-* packages package.json pins, as az may use them.

    Fills REFUSED with the ones it can't, and why.
    """
    me = manifest(PACKAGE) or {}
    pins = {n: v for n, v in (me.get("dependencies") or {}).items() if n.startswith("@ai-ecoverse/py-")}
    python_dir = os.path.realpath(sys.base_prefix)
    python = manifest(python_dir) or {}
    if python.get("name") != PYTHON:
        for npm in pins:
            REFUSED[npm] = f"this python ({python_dir}) isn't {PYTHON}"
        return []
    want = (python.get("slicc") or {}).get("python") or {}
    found = {}
    for npm, pin in pins.items():
        d = resolve(PACKAGE, npm)
        m = manifest(d) if d else None
        py = ((m or {}).get("slicc") or {}).get("python") or {}
        req = py.get("requires") or {}
        deps = (m or {}).get("dependencies") or {}
        if not m:
            REFUSED[npm] = f"it isn't installed beside az (az needs {pin})"
        elif m.get("name") != npm or m.get("version") != pin:
            REFUSED[npm] = f"{d} is {m.get('name')} {m.get('version')}, az needs {npm} {pin}"
        elif not isinstance(py.get("sitePackages"), str):
            REFUSED[npm] = f"{d}/package.json has no slicc.python.sitePackages"
        elif any(req.get(k) not in (None, want.get(k)) for k in ("abi", "platform")):
            REFUSED[npm] = f"{npm} {pin} is built for {req.get('abi')}/{req.get('platform')}, this python is {want.get('abi')}/{want.get('platform')}"
        elif PYTHON in deps:
            dep = resolve(d, PYTHON)
            got = (manifest(dep) or {}).get("version") if dep else deps[PYTHON]
            if dep != python_dir and got != python.get("version") and not (dep is None and in_range(python.get("version"), got)):
                REFUSED[npm] = f"{npm} {pin} is for wasix-python {got}, this python is {python.get('version')}"
        if npm not in REFUSED:
            found[npm] = (d, deps)
    # A py-* package's own py-* dependencies must be the copies az takes (one
    # _cffi_backend for everything), and az must take them.
    changed = True
    while changed:
        changed = False
        for npm, (d, deps) in list(found.items()):
            for dep in deps:
                if not dep.startswith("@ai-ecoverse/py-"):
                    continue
                if dep not in found:
                    why = REFUSED.get(dep, "az doesn't depend on it")
                    REFUSED[npm] = f"it needs {dep}, which az couldn't use: {why}"
                elif resolve(d, dep) != found[dep][0]:
                    REFUSED[npm] = f"its {dep} is {resolve(d, dep)}, not az's {found[dep][0]}"
                else:
                    continue
                del found[npm]
                changed = True
                break
    return [os.path.join(d, manifest(d)["slicc"]["python"]["sitePackages"]) for d, _ in found.values()]


def env_name(section, option):
    return f"AZURE_{section}_{option}".upper().replace("-", "_").replace(".", "_")


def user_config():
    path = os.path.join(os.environ.get("AZURE_CONFIG_DIR") or os.path.expanduser(os.path.join("~", ".azure")), "config")
    config = configparser.ConfigParser()
    try:
        config.read(path, encoding="utf-8")
    except (configparser.Error, OSError, UnicodeError):
        pass  # az reports a broken config itself
    return config


def isolate():
    """Leave only the standard library, SITE and az's own py-* packages on sys.path."""
    gone = [p for p in sys.path if "site-packages" in p or "dist-packages" in p]
    keep = [p for p in sys.path if p not in gone and p != ""]
    own = own_packages()
    rest = [p for p in gone if p not in own] if os.environ.get("AZURE_CLI_SITEPACKAGES") else []
    sys.path[:] = [SITE] + keep + own + rest
    roots = tuple(os.path.join(os.path.realpath(p), "") for p in gone if p)
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if f and os.path.realpath(f).startswith(roots):
            del sys.modules[name]
    import importlib

    importlib.invalidate_caches()


def main():
    if os.path.basename(__file__) != "az":
        sys.exit(f"{os.path.basename(__file__)}: this launcher runs only as az")
    env = os.environ
    isolate()
    sys.meta_path.append(NativeFinder)
    if sys.stdout is not None:
        sys.stdout = QuietPipe(sys.stdout)
    import warnings

    warnings.filterwarnings("ignore", category=SyntaxWarning)
    ca = env.get("SSL_CERT_FILE")
    if ca and os.path.isfile(ca):
        env.setdefault("REQUESTS_CA_BUNDLE", ca)
    config = user_config()
    for section, option, value in DEFAULTS:
        if not config.has_option(section, option):
            env.setdefault(env_name(section, option), value)
    env.setdefault(env_name("core", "encrypt_token_cache"), "false")

    runpy.run_module("azure.cli", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
