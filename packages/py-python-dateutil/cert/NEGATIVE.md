# py-python-dateutil: negative proof

## The version-neutral release (homescoop#1283; 2026-10-20)

The previous revision declares `lib/python3.14/site-packages` and ships `__pycache__/*.cpython-314.pyc`. On wasix-python 3.15 it imports only because discovery adds the declared path, and its .pyc are dead weight: 3.15 ignores them. The bios `.pth` writer lists the `python3.14` path explicitly. This release stages into `lib/python3/site-packages` with no .pyc. Every spec passes on wasix-python 3.14.2-28 and 3.15.0-3 (slicc-kernel 1.125.0), and cert/record.mjs asserts there's no .pyc.

## 2.9.0-post0.3 (homescoop#625): main couldn't build 2.9.0-post0.2, and its exact py-six pin nests a second six

**Behaviour.** npm's 2.9.0-post0.2 is byte-equivalent in behaviour. Its files are the wheel's, by RECORD: `record.mjs` passes on it (24 files, 18 `.pyc`). `dateutil.mjs` passes too.

**Build.** main can't build it. `host-run.sh py-python-dateutil` stops with `missing packages/py-python-dateutil/package/lib/python3.14/site-packages (stage pure wheel into package/ first)`. 2.9.0-post0.3 stages the pinned wheel with `scripts/stage-pure-wheel.sh`.

**The py-six pin.** `npm install --package-lock-only @ai-ecoverse/py-python-dateutil@2.9.0-post0.2 @ai-ecoverse/py-six@1.17.0-3` (2026-10-16) gives two copies:

```
node_modules/@ai-ecoverse/py-python-dateutil/node_modules/@ai-ecoverse/py-six 1.17.0-2
node_modules/@ai-ecoverse/py-six 1.17.0-3
```

With 2.9.0-post0.3's `">=1.17.0-3 <1.17.1"`, the same install resolves one py-six, at the top level.

**The self-test.** `record.mjs` checks itself on every run: a flipped byte in a copy has to be reported, both as a RECORD mismatch and as a stale `.pyc`.
