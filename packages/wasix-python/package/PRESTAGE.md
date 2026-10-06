# wasix-python 3.14.2-9

Relinked against wasix-sysroot **2025.9.30-14** (fixed `fcntl` F_SETFD).

## PRESTAGE (SLICC)
```python
import fcntl, subprocess
assert fcntl.fcntl(1, fcntl.F_SETFD, 0) == 0
assert fcntl.fcntl(1, fcntl.F_GETFD) == 0
r = subprocess.run(["echo", "x"], capture_output=True, text=True)
assert r.stdout.strip() == "x"
```
