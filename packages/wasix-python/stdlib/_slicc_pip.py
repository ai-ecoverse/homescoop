"""Refuse pip installs of packages homescoop ships as WASIX natives (pydata).

PyPI has no wasm32-wasix wheels for these; pip falls back to an sdist build
(cmake/ninja/…) that hangs or fails slowly. The working builds are the
@ai-ecoverse/py-* packages, exposed in seven as Python data tools (pydata /
slicc-py-datatools) and discovered via slicc.python.sitePackages.

Source of truth for PyPI keys / npm / catalog membership:
`packages/wasi-uv/homescoop-pydata-map.json` (shared with wasi-uv). Keep the
dict below identical; `scripts/test/wasi-uv-pydata-map.test.mjs` checks both.

Pure-Python packages (six, formulas with --no-deps after pydata, …) are not
in this map and keep working through pip.
"""
from __future__ import annotations

import sys

# PyPI project name (PEP 503 normalized) → {npm, catalog}.
# catalog "pydata" → seven Install/Update → Python data tools; null → still
# refuse (matplotlib deps / pulled in with pydata) but hint names the npm id.
# Keys must match packages/wasi-uv/homescoop-pydata-map.json exactly.
HOMESCOOP_PIP_NATIVE = {
    "numpy": {"npm": "@ai-ecoverse/py-numpy", "catalog": "pydata"},
    "scipy": {"npm": "@ai-ecoverse/py-scipy", "catalog": "pydata"},
    "pandas": {"npm": "@ai-ecoverse/py-pandas", "catalog": "pydata"},
    "matplotlib": {"npm": "@ai-ecoverse/py-matplotlib", "catalog": "pydata"},
    "pillow": {"npm": "@ai-ecoverse/py-pillow", "catalog": None},
    "contourpy": {"npm": "@ai-ecoverse/py-contourpy", "catalog": None},
    "kiwisolver": {"npm": "@ai-ecoverse/py-kiwisolver", "catalog": None},
}

_CATALOG = "Python data tools"
_CATALOG_ID = "pydata"


def canonicalize(name: str) -> str:
    """PEP 503 normalization: lowercase, `_` and `.` → `-`."""
    return name.lower().replace("_", "-").replace(".", "-")


def entry(name: str) -> dict | None:
    """Map entry for a PyPI project name, or None if pip may install it."""
    if not name:
        return None
    return HOMESCOOP_PIP_NATIVE.get(canonicalize(name.partition("[")[0]))


def lookup(name: str) -> str | None:
    """npm id for a PyPI project name, or None if pip may install it."""
    e = entry(name)
    return None if e is None else e["npm"]


def hint_message(hits: list[tuple[str, str]]) -> str:
    """User-facing InstallationError text for one or more blocked packages."""
    # Preserve first-seen order; dedupe by normalized PyPI name.
    seen: set[str] = set()
    ordered: list[tuple[str, dict]] = []
    for pypi, _npm in hits:
        key = canonicalize(pypi)
        if key in seen:
            continue
        e = HOMESCOOP_PIP_NATIVE.get(key)
        if e is None:
            continue
        seen.add(key)
        ordered.append((key, e))
    if not ordered:
        return "pip cannot install this package on WASIX."
    names = ", ".join(p for p, _ in ordered)
    npms = " ".join(sorted({e["npm"] for _, e in ordered}))
    plural = "these packages" if len(ordered) > 1 else "this package"
    wants_pydata = any(e.get("catalog") == _CATALOG_ID for _, e in ordered)
    lines = [
        f"pip cannot install {names} on WASIX (no wasm32-wasix wheel; "
        f"building from an sdist hangs or fails).",
        "",
    ]
    if wants_pydata:
        lines.append(
            f"Install {_CATALOG} ({_CATALOG_ID}) from seven's Install/Update, or:"
        )
        lines.append(f"  pnpm add -g {npms}")
    else:
        # pillow / contourpy / kiwisolver: catalog null in the shared map.
        lines.append(
            f"Install {_CATALOG} ({_CATALOG_ID}), which pulls these in via "
            f"matplotlib, or:"
        )
        lines.append(f"  pnpm add -g {npms}")
    lines.extend(
        [
            "",
            "Pure-Python packages from PyPI still work (e.g. pip install six). "
            f"After {_CATALOG_ID} is installed, use --no-deps for packages that "
            f"only need {plural} (e.g. pip install --no-deps formulas).",
        ]
    )
    return "\n".join(lines)


def refuse(name: str) -> str | None:
    """If `name` is blocked, return the hint message; else None."""
    e = entry(name)
    if e is None:
        return None
    key = canonicalize(name.partition("[")[0])
    return hint_message([(key, e["npm"])])


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
