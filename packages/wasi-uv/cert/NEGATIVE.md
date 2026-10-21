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

## 0.13.1-5: the README's uvx example, the stress row's harness calls (homescoop#1486, #1489, 2026-10-21)

- **The README example:** 0.13.1-4's README showed `uvx ruff check .`. ruff ships only native wheels and a Rust sdist, so in seven uv rejects it ("no wheels with a matching platform tag … wasi_0_0_0_wasm32"). The example is now `uvx --from charset-normalizer normalizer file.txt`, and the checklist runs it as written.
- **The stress row:** 0.13.1-4's `cert/stress.mjs` ran each round in one harness call, which under users enforce on CI took about 246 s, past the 120 s limit. Since -5 rounds run detached and are polled. The published -4 passes the new row locally on 1.134.3 (users enforce): 35–43 s a round, 0 traps.
- **uv.wasm is unchanged.**


## Cert only: the six sdist builds run detached (homescoop#1541, 2026-10-21)

- **What failed:** cert-review of #1518 on slicc-kernel 1.142.1 (users enforce) stopped at `uv pip install --no-binary six six` with `Runtime.evaluate: no answer in 120000 ms`, for 0.13.1-4 and -5 alike (the same uv.wasm). The build wasn't hung: on that runner, which also runs the live-pair Chromes and the review agent, it took 151 s on 1.134.3 and 181 s on 1.142.1. The same step took 27 s in ladder-pr's `cert (wasi-uv)` (run 39544921920) and 11–27 s locally.
- **The change:** `checklist.mjs`'s sdist build and both `locks.mjs` races run detached (`cert/lib/detached.mjs`) and are polled with short calls, under a 300 s deadline each. A run past the deadline fails with `wasi-uv: FAIL <command>: no exit within 300 s (detached, polled; N s)` and kills the command. Each finished build logs `rc=<n> in <s> s (budget 300 s)`, so a slowdown shows up as a number.
- **The old spec fails:** `scripts/test/wasi-uv-detached.test.mjs` fails on main's `checklist.mjs` and `locks.mjs` (the sdist build and the races are single blocking calls). Its host tests run the helper under real bash: a nonzero rc comes back as that rc, a command past the budget is a FAIL, and a runner that never reports is a FAIL too.
- **Real failures still fail** (0.13.1-5, slicc-kernel 1.142.1, users enforce):
  - `prove-negative.mjs` (every command's wasm emptied) fails 4 of 5 specs: checklist, interrupt, locks and stress;
  - the published 0.13.1-1 fails the new `locks.mjs` at `B waited for A's lock on the venv`, after the detached race returned rc 0 in 12 s;
  - `six==9.9` in place of `six` fails the checklist row with uv's rc 1 ("no version of six==9.9");
  - a 5 s budget fails the checklist and locks with `no exit within 5 s`.
- **Kernel timing:** no regression from 1.134.3 to 1.142.1. Twenty `--no-cache` six sdist builds (two runs of five on each kernel, local, users enforce) took a median of 17 s on 1.134.3 and 19 s on 1.142.1, with each kernel's spread (13–24 s and 14–27 s) wider than the gap. Full suites: stress rounds took 39–47 s on 1.134.3 and 35–39 s on 1.142.1.
