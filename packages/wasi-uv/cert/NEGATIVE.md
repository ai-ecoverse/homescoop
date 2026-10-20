# Negative proof (wasi-uv)

## 0.13.1-2: file locks (homescoop#706, 2026-10-16)

`cert/locks.mjs` against the published 0.13.1-1 (slicc-kernel 1.100.4, users enforce): FAIL at `B waited for A's lock on the venv`. The race went `a-held | a-running | b=0 | a=0`: A (`uv -vv pip install --no-binary six six`) logged `Acquired exclusive lock for .venv` and was still running when B (`uv -v pip install idna`) started. B never logged `Waiting to acquire`; it resolved, prepared and installed idna into the same site-packages while A was building six. In 0.13.1-1, 0003's `LockedFileMode::try_lock`/`lock` on WASI returned `Ok(())` without a lock. 0.13.1-2 takes them through `slicc.fcntl_lock`.

Across browser tabs: when this was written, locks were per kernel, so two tabs on one OPFS cache didn't see each other's locks (slicc-kernel#675). That was fixed in 1.119.0 (slicc-kernel#944), and writes under the locks became coherent across tabs in 1.120.1 (slicc-kernel#949). homescoop#952 updated the README.

## 0.13.1-3: the allocator refresh and the initial heap (homescoop#1287, 2026-10-20)

The published 0.13.1-2 passes the new stress row's traps check: 6 rounds of 41 local wheels, 0 traps, on slicc-kernel 1.134.3. The trap is a V8 race (slicc-kernel#1172) seen at 5–12% of rounds under heavier allocation (azw9's canary, wasi-pnpm's loop), so the row is a guard, not a negative. 0.13.1-2's peak there is 17 MiB. A 200-wheel variant didn't finish: the harness's 120 s CDP answer limit ran out while writing 12,000 files, which isn't uv. The recorded heap is 64 MiB.

## 0.13.1-4: uvx, ending uv (homescoop#771, #910, #911, 2026-10-20)

- **uvx:** the published 0.13.1-3 has no `uvx` command, so the checklist's `uvx --version` exits 127 ("command not found"). -4's package.json (the same uv.wasm) passes the whole suite on slicc-kernel 1.134.3, users enforce.
- **`cert/interrupt.mjs`** passes with 0.13.1-3 too on 1.134.3. Both cases were kernel problems, now fixed: on 1.100.4 a `kill -9` could be lost (slicc-kernel#755, fixed in 1.104.1, now the engines floor), and on 1.110.7 ^C didn't end uv (homescoop#911). The row keeps both from coming back.
- **homescoop#674** (the config was written to the wrong HOME) was fixed in the spec by `UV_CONFIG_FILE` on every run. uvx's row also asserts that nothing asks pypi.org.

