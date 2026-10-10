# Patches

WASIX / wasixcc portability patches for OpenSSH portable, applied by
`build.sh` in lexical order (`*.patch`).

Each patch must be named in `cert/meta.json` under `patches` with a cert case
that exercises the changed path (see `docs/ci-cert.md`). Prefer configure
cache overrides and documented limitations over patches when possible.

| patch / stub | why |
| --- | --- |
| `0001-wasix-stub-getrrsetbyname.patch` | stub SSHFP `getrrsetbyname` (no libresolv) |
| `openbsd-compat/include/{resolv,util}.h` (written by `build.sh`) | `sshkey.c` etc. `#include <resolv.h>` / `<util.h>` for b64_* / libutil; wasix-libc has neither |
