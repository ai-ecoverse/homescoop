# wasix-m4 1.4.20-2

Relinked against wasix-sysroot **2025.9.30-14** (fixed `fcntl` F_SETFD).

## PRESTAGE (SLICC)
```sh
echo 'define(x,y)x' | m4   # → y
# F_SETFD round-trip via a tiny C helper linked with the same sysroot, or:
# m4's own configure probes exercised fcntl during rebuild.
```
