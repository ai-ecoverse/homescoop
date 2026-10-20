# py-tzdata: negative proof

## The version-neutral release (homescoop#1283; 2026-10-20)

The previous revision declares `lib/python3.14/site-packages` and ships `__pycache__/*.cpython-314.pyc`. On wasix-python 3.15 it imports only because discovery adds the declared path, and its .pyc are dead weight: 3.15 ignores them. The bios `.pth` writer lists the `python3.14` path explicitly. This release stages into `lib/python3/site-packages` with no .pyc. Every spec passes on wasix-python 3.14.2-28 and 3.15.0-3 (slicc-kernel 1.125.0), and cert/record.mjs asserts there's no .pyc.

## 2026.4.0-3 (homescoop#625): 2026.4.0-2 behaves the same; main couldn't build it

**2026.4.0-2 is byte-equivalent in behaviour.** npm's 2026.4.0-2 passes all three specs on slicc-kernel 1.102.6's Node entry (2026-10-16): `import.mjs`, `tzdata.mjs` and `record.mjs`. Its files are tzdata-2026.4-py2.py3-none-any.whl's, by RECORD, and its `.pyc` match their sources. 2026.4.0-3 changes how the package is built, not what it does. It stages the pinned wheel with `scripts/stage-pure-wheel.sh` and compiles its `.pyc` in CI. The only difference in the tarball is the build path compiled into the `.pyc` (importlib replaces it with the installed path at import).

**What fails without this release:** main can't build 2026.4.0-2. `host-run.sh py-tzdata` stops with `missing packages/py-tzdata/package/lib/python3.14/site-packages (stage pure wheel into package/ first)`, so ladder-pr's host-build failed for any PR that touched the recipe, and npm-parity couldn't compare it (#625).

**The specs aren't vacuous.** `record.mjs` checks itself on every run. It copies the site-packages, flips one byte of the first `.py`, and has to report exactly that file as a RECORD mismatch, and its `.pyc` as stale. `import.mjs` checks where the module came from, and `tzdata.mjs` asserts exact results.
