# Fail-fast for homescoop-served natives (uv)

Status: **design only** — do not ship a half-applied patch until
`@ai-ecoverse/wasi-uv` is back in seven’s optional catalog (attested rebuild;
bios retired the old `wasix-uv-shim` under catalog id `uv`, and the real
package is not offered yet). Pip is the stand-in (`wasix-python`); see sibling
work on the same PyPI→catalog map.

## Today

| Item | State |
| --- | --- |
| Package | `@ai-ecoverse/wasi-uv` 0.13.6-2 (`packages/wasi-uv`), Astral uv for slicc |
| Shim | `@ai-ecoverse/wasix-uv-shim` retired (`builder: retired`); was catalog `uv` |
| In seven | Not offered: bios optional catalog has no wasi-uv row; README says use pip until attested rebuild |
| Platform tag | `wasi_0_0_0_wasm32` (patch 0004); PyPI has no such wheels |
| What works | Pure-Python wheels/sdists (`six`, `idna`, …), `uv venv` / `add` / `sync` / `run` of those |
| What hangs | `uv add` / `uv pip install` / `uv sync` of numpy/scipy/… (or transitive, e.g. `formulas` → numpy): sdist + cmake/ninja, same class of failure as pip |

Map of packages to refuse: [`homescoop-pydata-map.json`](./homescoop-pydata-map.json).
Host test: `scripts/test/wasi-uv-pydata-map.test.mjs` keeps it aligned with
`packages/py-*` that declare a CPython ABI.

## Hook (when wasi-uv returns)

Implement as a new series patch, e.g.
`0007-wasi-refuse-homescoop-natives.patch`, applied by `apply.sh` after 0006.

### Where

`crates/uv-distribution/src/source/mod.rs`, in
`SourceDistributionBuilder::build_distribution`, immediately after the existing
`no_build_requirement` / `Error::NoBuild` guard (upstream already refuses
builds when `--no-build` applies). That path runs for:

- `uv pip install <pkg>`
- `uv add <pkg>` / `uv sync` (resolver → build)
- transitive sdists (e.g. `formulas` pulling `numpy`)

Refuse by **normalized PyPI name** from `source.name()` before any download of
build deps or PEP 517 isolation. Do not rely on an agent bash policy.

Optional second check: when a registry candidate is sdist-only for a mapped
name, fail in the same place (build is the only remaining path on WASIX).

### Message

Use `messageTemplate` from the map. Example for numpy:

```
error: `numpy` has no WASIX wheel on PyPI and cannot be built from source here (platform tag wasi_0_0_0_wasm32).
Install Install/Update → Python data tools (pydata), or: pnpm add -g @ai-ecoverse/py-numpy
Then install pure-Python dependents with --no-deps (or uv's equivalent).
```

For pillow/contourpy/kiwisolver (`catalog: null`), omit the pydata line and
only name the `@ai-ecoverse/py-*` package (or say “install Python data tools,
which pulls these in via matplotlib”).

Prefer a dedicated `Error` variant (e.g. `HomescoopNative { name, npm, catalog }`)
so the wording stays stable across uv upgrades; a plain `anyhow` string also
works if regenerating the patch on every Renovate bump is acceptable.

### Map embedding

Bake the `packages` table into the Rust patch as a `const` match/phf on
normalized names (`numpy`, not `Numpy` / `NumPy`). Keep
`homescoop-pydata-map.json` as the source of truth; the host test fails if the
patch’s names drift (same pattern as crate-version checks in
`scripts/test/wasi-uv-cert.test.mjs`).

Share the **same PyPI keys** with the wasix-python pip fail-fast
(@thread:thr_tgtt7c3x7k). Pip landed runtime `HOMESCOOP_PIP_NATIVE` in
`packages/wasix-python/stdlib/_slicc_pip.py` keyed off this JSON; keep both
in lockstep (`scripts/test/wasi-uv-pydata-map.test.mjs`). Do not fork the names.

### Out of scope

- Pure-Python `py-*` (six, packaging, pyparsing, cycler, fonttools,
  python-dateutil, pytz, tzdata): leave PyPI alone.
- Rewriting installs to npm from inside uv (no npm client in the WASI command).
- Agent-only argv interception.

## Verify (after the patch ships)

In seven with wasi-uv installed:

1. `uv pip install six` — still succeeds.
2. `uv pip install numpy` / `uv add numpy` — fails in seconds with the map
   message (no cmake/ninja).
3. `uv pip install formulas` — fails fast on transitive `numpy` (or scipy),
   same message.
4. With pydata already installed: `uv pip install --no-deps formulas` (or
   project deps with natives satisfied via site discovery) still works for the
   pure-Python layer.
5. Cert: add a row to `cert/checklist.mjs` (or a small `cert/pydata.mjs`) that
   asserts the refusal text and a zero-second-class timeout; host test covers
   the map.

## Why not now

Shipping the refusal in npm without catalog return leaves a package users are
told not to install, while seven terminals keep using pip. Prefer landing the
pip fail-fast first, then folding this patch into the attested wasi-uv rebuild
that restores catalog id `uv`.
