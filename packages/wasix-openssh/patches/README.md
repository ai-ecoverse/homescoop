# Patches

WASIX / wasixcc portability patches for OpenSSH portable, applied by
`build.sh` in lexical order (`*.patch`).

Each patch must be named in `cert/meta.json` under `patches` with a cert case
that exercises the changed path (see `docs/ci-cert.md`). Prefer configure
cache overrides and documented limitations over patches when possible.

No patches in the draft scaffold yet — first CI configure/make will show
what is required.
