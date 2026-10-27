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

## Cert only: a timeout kills the whole process group (homescoop#1578, 2026-10-21)

- **What was wrong:** `cert/lib/detached.mjs` (#1541) killed only the wrapper `bash cmd.sh` on a timeout. uv, its child, was reparented to init and kept running, so a hung uv could outlive its case and hold its locks.
- **The change:** the runner starts with `set -m`, so the wrapper is a process-group leader (its pid is the group id), and a timeout runs `kill -9 -- -<pgid>` before killing the wrapper itself.
- **The new row, `cert/timeout.mjs`:** a `uv run --no-project python -c '…time.sleep(600)'` runs detached under a 15 s budget. The spec checks that uv is running, that the case fails with `wasi-uv: FAIL … no exit within 15 s`, and that afterwards `/proc/*/stat` lists no `uv` or `python` process.
- **The old helper fails it** (0.13.1-5, slicc-kernel 1.134.3, users enforce): `a timed-out detached uv leaves no uv or python behind (homescoop#1578): 1017 (uv) S 1 1007 … | 1021 (python) S 1017 1007 …`, so uv (parent now 1) and its python were still there. With the new helper the row passes: uv and python, 2 processes, are gone.
- **Host test:** `scripts/test/wasi-uv-detached.test.mjs` has a case where the command forks `sleep 30` and waits; after the timeout the sleep must be dead. It fails with the old helper (1 of 7), since only the wrapper died.

## 0.13.2-1: uv 0.13.2 (Renovate #1913, 2026-10-27)

- **The rebase:** 0001 and 0002 no longer applied to 0.13.2 (Cargo.toml's `indicatif` line gained an `iri-string` neighbour; `url` left uv-installer's and uv-project-commands' dependencies; `DisplaySafeUrl` became `SafeUrl` next to keyring.rs's imports; run.rs lost `use url::Url`). Every patch is regenerated against the 0.13.2 tree with the same content; none was dropped, since upstream does none of it. 0.13.2 adds no process spawn site and no `cfg(unix)` branch outside tests (run.rs's new `#[cfg(unix)]` import serves the stdin-script branch 0.13.1 already had), and builds for wasm32-wasip1-threads without new gating.
- **The existing rows pass** on 0.13.2-1 (slicc-kernel 1.134.3, the kernel's default users mode): checklist, interrupt, locks, stress (6 rounds, 0 traps) and timeout.
- **The new row, `cert/compile.mjs`,** fails on the published 0.13.1-5 at its first refusal: `uv pip compile requirements.in --python-version 3.14.0.1` panics (`Valid PythonVersions should be valid VersionRequests: InvalidVersionRequest("3.14.0.1")`, `uv: wasm trap in thread 2: unreachable`, rc 134). Probed one by one, 0.13.1-5 fails each of the row's 0.13.2 checks:
  - `--format pylock.toml -o /` resolves and then panics (`called Option::unwrap() on a None value`, rc 134);
  - `uv export --format pylock.toml` writes no `environments` line for a project with `tool.uv.environments`;
  - `uv pip install -r` of a pylock.toml whose `environments` is `sys_platform == 'linux'` installs idna into the wasi environment (rc 0);
  - `uv pip check -q` exits 1 and prints nothing.
  0.13.2-1 passes the whole row.
- **The heap (homescoop#1287):** at the 64 MiB initial heap the stress row's VmSize stays at 64 MiB (65,536 kB) every round for 0.13.2-1, so uv never grows the memory. Linked at the default heap (5 MiB) to see the real peak, the stress row peaks at 7,360 kB with 0.13.2-1 and 7,488 kB with 0.13.1-5's source (6 rounds each, 0 traps). The peak didn't move; the 64 MiB initial heap stays. The 17 MiB in the old `measured-by` was 0.13.1-2's, before 0006.
