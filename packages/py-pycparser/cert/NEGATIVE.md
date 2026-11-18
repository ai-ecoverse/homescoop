# py-pycparser: negative proof

## 3.12.0-1 (homescoop#2119; 2026-11-17)

This is the first release, so there's no earlier one to fail. The negative is a broken copy of this tarball whose `pycparser/c_lexer.py` only raises `ImportError`. Run on slicc-kernel 1.189.2 and wasix-python 3.15.0-8 with `scripts/browser-cert/run.mjs --package py-pycparser`:

- `cert/import.mjs` and `cert/parse.mjs` fail: `ImportError: removed for the negative`.
- `cert/record.mjs` fails: `"mismatch":["pycparser/c_lexer.py"]` against the wheel's RECORD.

The real tarball passes all three. `parse.mjs` asserts exact node types and a regenerated function. `record.mjs` checks itself on every run by flipping one byte in a copy.
