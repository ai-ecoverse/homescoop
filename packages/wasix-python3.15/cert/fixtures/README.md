# ctypes cert fixtures

`libside-add.so` is a wasixcc PIC / `dylink.0` side module exporting
`int side_add(int, int)`. Rebuild (sysroot-ehpic, `WASIXCC_PIC=yes`):

```bash
wasixcc -O2 -fPIC -matomics -mbulk-memory -pthread -shared \
  side-add.c -o libside-add.so
```
