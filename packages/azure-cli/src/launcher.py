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
  - The native modules upstream's closure has and this package doesn't
    (cryptography, PyNaCl, ..., NATIVE below) fail cleanly: an import that
    nothing else on sys.path answers raises a ModuleNotFoundError that is
    also an az error, so az prints one ERROR line that names what is missing
    and exits 1, instead of an "unexpected error" traceback. Code that tries
    the import and falls back (PyJWT, az's telemetry) still catches it.
  - SyntaxWarnings are off: nothing here is precompiled (the tree is the same
    for every Python), so each run compiles what it imports, and some of the
    SDKs' docstrings would warn on every run, not once as with a __pycache__.
"""
import configparser
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
# Native code in upstream's closure that this package leaves out (wheels.lock
# lists each with its reason), and what an import of it says.
NATIVE = {
    "cryptography": "cryptography (native code: Rust and OpenSSL)",
    "OpenSSL": "pyOpenSSL (it needs cryptography, native code)",
    "nacl": "PyNaCl (native code: libsodium)",
    "bcrypt": "bcrypt (native code)",
    "cffi": "cffi (native code)",
    "psutil": "psutil (native code)",
    "paramiko": "paramiko, for SSH (it needs cryptography, bcrypt and PyNaCl, native code)",
    "fabric": "fabric, for SSH (it needs paramiko and cryptography, native code)",
    "scp": "scp, for SSH (it needs paramiko and cryptography, native code)",
    "sshtunnel": "sshtunnel, for SSH (it needs paramiko and cryptography, native code)",
}
README = "https://github.com/ai-ecoverse/homescoop/tree/main/packages/azure-cli/package#whats-not-available"


class NativeFinder:
    """Last on sys.meta_path: answers the NATIVE imports nothing else found."""

    @staticmethod
    def find_spec(fullname, path=None, target=None):
        top = fullname.partition(".")[0]
        if top not in NATIVE:
            return None
        from azure.cli.core.azclierror import UserFault

        class NativeModuleUnavailable(ModuleNotFoundError, UserFault):
            def __init__(self, msg, name):
                UserFault.__init__(self, msg, f"Commands that need native code don't run in slicc; see {README}")
                self.msg = msg
                self.name = name

        raise NativeModuleUnavailable(
            f"This command needs {NATIVE[top]}. @ai-ecoverse/azure-cli has only pure-Python code, "
            f"so that it runs on wasix-python, and doesn't include it (No module named '{fullname}').",
            fullname,
        )


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
    """Leave only the standard library and SITE on sys.path."""
    gone = [p for p in sys.path if "site-packages" in p or "dist-packages" in p]
    keep = [p for p in sys.path if p not in gone and p != ""]
    sys.path[:] = [SITE] + keep + (gone if os.environ.get("AZURE_CLI_SITEPACKAGES") else [])
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
