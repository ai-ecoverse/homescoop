# Negative proof (wasi-uv)

## 0.13.1-2: file locks (homescoop#706, 2026-10-16)

`cert/locks.mjs` against the published 0.13.1-1 (slicc-kernel 1.100.4, users enforce): FAIL at `B waited for A's lock on the venv`. The race went `a-held | a-running | b=0 | a=0`: A (`uv -vv pip install --no-binary six six`) logged `Acquired exclusive lock for .venv` and was still running when B (`uv -v pip install idna`) started. B never logged `Waiting to acquire`; it resolved, prepared and installed idna into the same site-packages while A was building six. In 0.13.1-1, 0003's `LockedFileMode::try_lock`/`lock` on WASI returned `Ok(())` without a lock. 0.13.1-2 takes them through `slicc.fcntl_lock`.

What's still not excluded: locks are per kernel, so two browser tabs (two kernels) on one OPFS cache don't see each other's locks (slicc-kernel#675).

## 0.13.1-3: the allocator refresh and the initial heap (homescoop#1287, 2026-10-20)

The published 0.13.1-2 passes the new stress row's traps check: 6 rounds of 41 local wheels, 0 traps, on slicc-kernel 1.134.3. The trap is a V8 race (slicc-kernel#1172) seen at 5–12% of rounds under heavier allocation (azw9's canary, wasi-pnpm's loop), so the row is a guard, not a negative. 0.13.1-2's peak there is 17 MiB. A 200-wheel variant didn't finish: the harness's 120 s CDP answer limit ran out while writing 12,000 files, which isn't uv. The recorded heap is 64 MiB.

