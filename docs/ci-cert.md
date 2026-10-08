# CI certification specs

Human certification remains the bar. `ladder-pr` browser-cert / host-smoke are
how that bar is **encoded in CI** so recipe bumps can automerge once a package
is listed in [`scripts/ci-certified.json`](../scripts/ci-certified.json).

## Layout

```text
packages/<name>/cert/
  meta.json          # optional: { "harness": "slicc-kernel" | "host-smoke" | "host-node" }
  *.mjs              # slicc-kernel CDP specs (default harness)
  NEGATIVE.md        # one recorded failure against a known-bad build
```

`scripts/browser-cert/run.mjs`:

1. If `cert/*.mjs` exists → boot slicc-kernel Chromium, install the PR tarball,
   run every `*.mjs` (default export `async (ctx) => …`).
2. Else if `browser-cert.json` or `slicc.commands` → legacy smoke (`--version` /
   JSON plan). **Not** enough for `ci-certified.json`.
3. Libs without commands → `host-smoke.sh` (`smoke.c`); mark CI-certified only
   when that smoke matches the checklist and `cert/NEGATIVE.md` exists.

## Harness choice

| Harness | Use for |
| --- | --- |
| **slicc-kernel CDP** (default) | Emscripten CLIs and WASI tools that run under `@ai-ecoverse/slicc-kernel` (jq, xz, git, coreutils, wasi-pnpm, wasix-python+numpy, …). |
| **host-smoke** | Static libs linked with `emcc` on the runner (`libpng`, `libtiff`, `lcms2`, `libxml2`, `libiconv`, `zlib`). |
| **host-node** | Special host scripts (`scripts/smoke-cmake.mjs`, `scripts/smoke-binaryen.mjs`). |
| **Full SLICC realm** | Scoop/ipk/UI-coupled or cone-only behaviour. Rare for homescoop publishables; prefer slicc-kernel. If a checklist truly needs the cone, add a `ladder-pr` job that starts a SLICC leader (same as `ladder-build` slicc path) and run `cert/*.mjs` there — call those out in `cert/meta.json` `"harness": "slicc-realm"`. |

## Patch ↔ spec mapping

Every `packages/<name>/*.patch` must be named in `cert/meta.json` under
`patches`, with a cert case that exercises the patched code path. Specs that
only smoke `--version` are not enough for patched packages.

## Enabling automerge

1. Port the checklist into `cert/` (and map every patch in `meta.json`).
2. Negative proof in `cert/NEGATIVE.md`:
   - **With patches:** rebuild once with the SLICC patch removed; the cert
     case that maps to that patch (or the build) must fail. Record the log.
   - **Without patches:** `prove-negative.mjs` (empty `.wasm`) plus an
     in-spec wrong-output / non-zero-exit assert.
3. Add the recipe dir name to `scripts/ci-certified.json` and run
   `node scripts/sync-ci-certified-renovate.mjs`.
4. Majors and brand-new packages stay `automerge: false` + label for human review.

Do **not** add `packages/<name>/cert/` stubs for blocked packages — any path under
`packages/<name>/` triggers `ladder-pr` host-build for that recipe.

## Not CI-certified yet (blocked)

| Package | Blocker |
| --- | --- |
| cmake | host-build needs `slicc-emscripten` prebuilt `cmakemain.cxx.o`; use `scripts/smoke-cmake.mjs` (`harness: host-node`) once staged |
| mount | needs slicc-kernel#92 (process mount/umount2) released; `cert/meta.json` `blocked` until then |
| findutils | 4.11.0 / gnulib getlocalename under emscripten; need `-exec`/`xargs -P` + wasm-coreutils |
| py-numpy / py-scipy / py-pandas | wasix stage/release 404 on Renovate bumps; import/numeric smoke under wasix-python once artifacts exist |

CI-certified set (automerge non-majors): see `scripts/ci-certified.json`
(jq, xz, pkgconf, xxd, coreutils, gawk, sed, gzip, git, grep, procps, which).

## Context API (`cert/*.mjs`)

```js
export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const r = await run(['jq', '-n', '1+1']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '2\n');
}
```

`run` accepts `{ cwd, env, stdin }`.
