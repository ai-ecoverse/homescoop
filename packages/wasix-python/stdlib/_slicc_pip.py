"""Refuse pip installs of packages homescoop ships as WASIX natives (pydata).

PyPI has no wasm32-wasix wheels for these; pip falls back to an sdist build
(cmake/ninja/…) that hangs or fails slowly. The working builds are the
@ai-ecoverse/py-* packages, exposed in seven as Python data tools (pydata /
slicc-py-datatools) and discovered via slicc.python.sitePackages.

Pure-Python packages (six, formulas with --no-deps after pydata, …) are not
in this map and keep working through pip.
"""
from __future__ import annotations

import sys

# PyPI project name (PEP 503 normalized) → npm package id.
# Keep in sync with packages/py-* that declare slicc.python.requires
# (abi/platform): those need the WASIX build. Pure-Python py-* stay off
# this map so `pip install six` and friends still work from PyPI.
HOMESCOOP_PIP_NATIVE = {
    "numpy": "@ai-ecoverse/py-numpy",
    "scipy": "@ai-ecoverse/py-scipy",
    "pandas": "@ai-ecoverse/py-pandas",
    "matplotlib": "@ai-ecoverse/py-matplotlib",
    "pillow": "@ai-ecoverse/py-pillow",
    "contourpy": "@ai-ecoverse/py-contourpy",
    "kiwisolver": "@ai-ecoverse/py-kiwisolver",
}

_CATALOG = "Python data tools"
_CATALOG_ID = "pydata"


def canonicalize(name: str) -> str:
    """PEP 503 normalization: lowercase, `_` and `.` → `-`."""
    return name.lower().replace("_", "-").replace(".", "-")


def lookup(name: str) -> str | None:
    """npm id for a PyPI project name, or None if pip may install it."""
    if not name:
        return None
    return HOMESCOOP_PIP_NATIVE.get(canonicalize(name.partition("[")[0]))


def hint_message(hits: list[tuple[str, str]]) -> str:
    """User-facing InstallationError text for one or more blocked packages."""
    # Preserve first-seen order; dedupe by normalized PyPI name.
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []
    for pypi, npm in hits:
        key = canonicalize(pypi)
        if key in seen:
            continue
        seen.add(key)
        ordered.append((key, npm))
    names = ", ".join(p for p, _ in ordered)
    npms = " ".join(sorted({n for _, n in ordered}))
    plural = "these packages" if len(ordered) > 1 else "this package"
    return (
        f"pip cannot install {names} on WASIX (no wasm32-wasix wheel; "
        f"building from an sdist hangs or fails).\n"
        f"\n"
        f"Install {_CATALOG} ({_CATALOG_ID}) from seven's Install/Update, or:\n"
        f"  pnpm add -g {npms}\n"
        f"\n"
        f"Pure-Python packages from PyPI still work (e.g. pip install six). "
        f"After {_CATALOG_ID} is installed, use --no-deps for packages that "
        f"only need {plural} (e.g. pip install --no-deps formulas)."
    )


def refuse(name: str) -> str | None:
    """If `name` is blocked, return the hint message; else None."""
    npm = lookup(name)
    if npm is None:
        return None
    return hint_message([(canonicalize(name.partition("[")[0]), npm)])


_patched = False


def _patch_factory(factory_mod) -> None:
    """Wrap Factory.find_candidates so blocked names fail before any download."""
    Factory = getattr(factory_mod, "Factory", None)
    if Factory is None or getattr(Factory, "_slicc_pip_guard", False):
        return
    orig = Factory.find_candidates

    def find_candidates(self, identifier, *args, **kwargs):
        msg = refuse(identifier)
        if msg is not None:
            from pip._internal.exceptions import InstallationError

            raise InstallationError(msg)
        return orig(self, identifier, *args, **kwargs)

    Factory.find_candidates = find_candidates
    Factory._slicc_pip_guard = True


def _wrap_factory_import() -> None:
    """Install a meta-path finder that wraps the factory module's loader."""
    import importlib.abc

    class FactoryFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path, target=None):
            mod = sys.modules.get("pip._internal.resolution.resolvelib.factory")
            if mod is not None:
                _patch_factory(mod)
            if fullname != "pip._internal.resolution.resolvelib.factory":
                return None
            for finder in sys.meta_path:
                if finder is self:
                    continue
                try:
                    spec = finder.find_spec(fullname, path, target)
                except (AttributeError, ValueError):
                    continue
                if spec is None or spec.loader is None:
                    continue
                orig_exec = getattr(spec.loader, "exec_module", None)
                if orig_exec is None:
                    return spec

                def exec_module(module, _orig=orig_exec):
                    _orig(module)
                    _patch_factory(module)

                spec.loader.exec_module = exec_module  # type: ignore[method-assign]
                return spec
            return None

    if any(isinstance(f, FactoryFinder) for f in sys.meta_path):
        return
    sys.meta_path.insert(0, FactoryFinder())


def install() -> None:
    """Idempotent: arm the pip guard for this interpreter process."""
    global _patched
    if _patched:
        return
    _patched = True
    mod = sys.modules.get("pip._internal.resolution.resolvelib.factory")
    if mod is not None:
        _patch_factory(mod)
        return
    _wrap_factory_import()
