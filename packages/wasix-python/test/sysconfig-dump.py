"""Print a _sysconfigdata file's build_time_vars, one KEY=repr per line,
sorted, for diffing two builds (homescoop#181 config review).

    python3 sysconfig-dump.py <_sysconfigdata__wasi_wasm32-wasix.py>
"""
import runpy
import sys

v = runpy.run_path(sys.argv[1])["build_time_vars"]
for k in sorted(v):
    print(f"{k}={v[k]!r}")
