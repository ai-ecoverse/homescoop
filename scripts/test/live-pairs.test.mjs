import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_PAIRS_MAX,
  ON_DEMAND_MAX,
  capNote,
  liveMax,
  planLivePairs,
  tierOf,
} from "../cert-review/live-pairs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts/cert-review/live-pairs.mjs");

// #1275's shape: 12 packages, a mix of C extensions, wasm commands, pure Python and a docs-only change.
const TWELVE = [
  { package: "py-six", tier: "no-binary" },
  { package: "py-numpy", tier: "binary" },
  { package: "wasm-sed", tier: "docs-only" },
  { package: "py-pyyaml", tier: "binary" },
  { package: "py-attrs", tier: "no-binary" },
  { package: "wasix-python", tier: "binary" },
  { package: "py-idna", tier: "no-binary" },
  { package: "py-markupsafe", tier: "binary" },
  { package: "py-certifi", tier: "no-binary" },
  { package: "py-pillow", tier: "binary" },
  { package: "py-packaging", tier: "no-binary" },
  { package: "py-charset-normalizer", tier: "no-binary" },
];

test("the default cap is 4 and at most 2 on-demand pairs", () => {
  assert.equal(LIVE_PAIRS_MAX, 4);
  assert.equal(ON_DEMAND_MAX, 2);
  assert.equal(liveMax(undefined), 4);
  assert.equal(liveMax(""), 4);
  assert.equal(liveMax("6"), 6);
  assert.equal(liveMax("0"), 0);
  assert.throws(() => liveMax("lots"), /LIVE_PAIRS_MAX/);
  assert.throws(() => liveMax("-1"), /LIVE_PAIRS_MAX/);
});

test("a 12-package plan starts 4 pairs and lists 8 as cap", () => {
  const plan = planLivePairs(TWELVE);
  assert.equal(plan.live.length, 4);
  assert.equal(plan.capped.length, 8);
  assert.deepEqual(
    plan.live.map((c) => c.package),
    ["py-markupsafe", "py-numpy", "py-pillow", "py-pyyaml"],
  );
  for (const c of plan.capped)
    assert.deepEqual([c.live, c.why], [false, "cap"]);
  assert.equal(
    plan.capped.at(-1).package,
    "wasm-sed",
    "a docs-only change comes last",
  );
  assert.deepEqual(plan.other, []);
});

test("a 3-package plan starts all 3", () => {
  const plan = planLivePairs(TWELVE.slice(0, 3));
  assert.deepEqual(plan.live.map((c) => c.package).sort(), [
    "py-numpy",
    "py-six",
    "wasm-sed",
  ]);
  assert.deepEqual(plan.capped, []);
});

test("the order is deterministic: binaries, then no binary, then docs-only, by name; input order never matters", () => {
  const want = planLivePairs(TWELVE, { max: 12 }).live.map((c) => c.package);
  assert.deepEqual(want, [
    "py-markupsafe",
    "py-numpy",
    "py-pillow",
    "py-pyyaml",
    "wasix-python",
    "py-attrs",
    "py-certifi",
    "py-charset-normalizer",
    "py-idna",
    "py-packaging",
    "py-six",
    "wasm-sed",
  ]);
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 20; i++) {
    const shuffled = [...TWELVE].sort(() => rand() - 0.5);
    assert.deepEqual(planLivePairs(shuffled), planLivePairs(TWELVE));
  }
});

test("packages whose harness isn't slicc-kernel get no pair and don't count against the cap", () => {
  const plan = planLivePairs([
    ...TWELVE.slice(0, 4),
    { package: "wasm-clang", tier: "binary", harness: "host-node" },
    { package: "x", tier: "binary", harness: "blocked" },
  ]);
  assert.equal(plan.live.length, 4);
  assert.deepEqual(plan.capped, []);
  assert.deepEqual(plan.other, [
    { package: "wasm-clang", live: false, why: "harness host-node" },
    { package: "x", live: false, why: "harness blocked" },
  ]);
});

test("the prompt text names every capped package as having no live pair (cap)", () => {
  const plan = planLivePairs(TWELVE);
  const note = capNote(plan);
  assert.match(note, /no live pair \(cap\)/);
  for (const c of plan.capped)
    assert.ok(note.includes(`\`${c.package}\``), c.package);
  for (const c of plan.live)
    assert.ok(note.includes(`\`${c.package}\``), c.package);
  assert.match(note, /ladder-pr's `cert \(<package>\)` jobs/);
  assert.match(note, /cert-run … run\.mjs/);
  assert.match(note, /live-pair start <package>/);
  assert.doesNotMatch(capNote(planLivePairs(TWELVE.slice(0, 3))), /cap\)/);
});

test("tiers: a shipped wasm or C extension is a binary, a docs-only change is last", () => {
  assert.equal(
    tierOf({
      files: ["package/package.json", "package/bin/sed.wasm"],
      changed: ["recipe.yaml"],
    }),
    "binary",
  );
  assert.equal(
    tierOf({
      files: [
        "package/lib/python3.13/site-packages/numpy/_core/_multiarray_umath.cpython-313-wasm32-wasi.so",
      ],
      changed: null,
    }),
    "binary",
  );
  assert.equal(
    tierOf({
      files: ["package/lib/python3.13/site-packages/six.py"],
      changed: ["recipe.yaml"],
    }),
    "no-binary",
  );
  assert.equal(
    tierOf({
      files: ["package/bin/sed.wasm"],
      changed: ["README.md", "package/README.md", "docs/usage.md"],
    }),
    "docs-only",
  );
  assert.equal(
    tierOf({ files: ["package/bin/sed.wasm"], changed: [] }),
    "binary",
    "a rebuild with no change under the package is judged by its tarball",
  );
});

function fakePr(dir, packages) {
  const art = join(dir, "artifacts");
  const root = join(dir, "root");
  for (const pkg of packages) {
    const stage = join(dir, "stage", pkg, "package");
    spawnSync("mkdir", [
      "-p",
      stage,
      join(art, `host-${pkg}-pr9`),
      join(root, "packages", pkg, "cert"),
    ]);
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify({ name: `@ai-ecoverse/${pkg}`, version: "1.0.0" }),
    );
    writeFileSync(
      join(stage, pkg.startsWith("py-") ? "mod.py" : "cmd.wasm"),
      "x",
    );
    spawnSync("tar", [
      "-czf",
      join(art, `host-${pkg}-pr9`, "package.tgz"),
      "-C",
      join(dir, "stage", pkg),
      "package",
    ]);
    writeFileSync(
      join(root, "packages", pkg, "cert", "meta.json"),
      JSON.stringify({
        harness: pkg === "wasm-host" ? "host-node" : "slicc-kernel",
      }),
    );
  }
  return { art, root };
}

test("up, start and stop: live.json lists the cap, a third on-demand pair is refused (a fake harness that only serves GET /)", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-pairs-"));
  try {
    const packages = [
      "wasm-a",
      "wasm-b",
      "wasm-c",
      "wasm-d",
      "wasm-e",
      "py-f",
      "py-g",
      "py-h",
      "wasm-host",
    ];
    const { art, root } = fakePr(dir, packages);
    // A tools dir whose run.mjs only serves its --live port and whose npm-tag.mjs fails (no baseline): head sides only, nothing real starts.
    const tools = join(dir, "tools");
    spawnSync("mkdir", ["-p", join(tools, "scripts/browser-cert")]);
    writeFileSync(
      join(tools, "scripts/browser-cert/run.mjs"),
      "import { createServer } from 'node:http';\nconst port = Number(process.argv[process.argv.indexOf('--live') + 1]);\ncreateServer((q, s) => s.end('{}')).listen(port, '127.0.0.1');\n",
    );
    writeFileSync(join(tools, "scripts/npm-tag.mjs"), "process.exit(1);\n");
    const live = join(dir, "live");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const run = (...args) =>
      spawnSync("node", [SCRIPT, ...args, "--live", live], {
        encoding: "utf8",
        env: { ...process.env, LIVE_PAIRS_MAX: "" },
      });
    const r = run(
      "up",
      "--packages",
      JSON.stringify(packages),
      "--root",
      root,
      "--tools",
      tools,
      "--artifacts",
      art,
      "--harness",
      join(dir, "h"),
      "--pr",
      "9",
      "--note",
      join(dir, "note.md"),
      "--port",
      String(port),
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /live-pairs: memory before the pairs: /);
    assert.match(r.stdout, /live-pairs: memory after the pairs: /);
    const entries = JSON.parse(readFileSync(join(live, "live.json"), "utf8"));
    const heads = entries.filter((e) => e.url).map((e) => e.package);
    assert.deepEqual(heads, ["wasm-a", "wasm-b", "wasm-c", "wasm-d"]);
    assert.deepEqual(
      entries.filter((e) => e.why === "cap").map((e) => e.package),
      ["wasm-e", "py-f", "py-g", "py-h"],
    );
    assert.deepEqual(
      entries.find((e) => e.package === "wasm-host"),
      { package: "wasm-host", live: false, why: "harness host-node" },
    );
    const note = readFileSync(join(dir, "note.md"), "utf8");
    for (const p of ["wasm-e", "py-f", "py-g", "py-h"])
      assert.ok(note.includes(`\`${p}\``), p);

    assert.equal(run("start", "wasm-e").status, 0);
    assert.equal(run("start", "py-f").status, 0);
    const third = run("start", "py-g");
    assert.notEqual(third.status, 0);
    assert.match(
      third.stderr,
      /refused: 2 on-demand pairs are open \(wasm-e, py-f\)/,
    );
    assert.match(run("start", "wasm-host").stderr, /harness host-node/);
    assert.match(run("start", "wasm-e").stderr, /already has a live pair/);
    assert.equal(run("stop", "wasm-e").status, 0);
    assert.equal(
      run("start", "py-g").status,
      0,
      "after a stop, another may start",
    );
    const pids = JSON.parse(readFileSync(join(live, "live.json"), "utf8"))
      .filter((e) => e.url)
      .map((e) => e.pid);
    assert.equal(run("stop-all").status, 0);
    const after = JSON.parse(readFileSync(join(live, "live.json"), "utf8"));
    assert.deepEqual(
      after.filter((e) => e.url),
      [],
    );
    for (const pid of pids) {
      let up = true;
      try {
        process.kill(pid, 0);
      } catch {
        up = false;
      }
      assert.equal(up, false, `pid ${pid} still runs after stop-all`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cert-review.yml runs the planner, names the cap in the prompt, offers live-pair, and stops the pairs always()", () => {
  const wf = readFileSync(
    join(ROOT, ".github/workflows/cert-review.yml"),
    "utf8",
  );
  assert.match(wf, /live-pairs\.mjs up --live "\$RUNNER_TEMP\/live"/);
  assert.match(wf, /LIVE_PAIRS_MAX: \$\{\{ vars\.LIVE_PAIRS_MAX \|\| '4' \}\}/);
  assert.match(wf, /\$\{\{ env\.LIVE_NOTE \}\}/);
  assert.match(wf, /bin\/live-pair"/);
  assert.match(
    wf,
    /- name: Stop the live pairs[^\n]*\n\s+if: always\(\)\n\s+run: node \.cert-review-tools\/scripts\/cert-review\/live-pairs\.mjs stop-all/,
  );
  const review = wf.indexOf("      - name: Review\n");
  const stop = wf.indexOf("      - name: Stop the live pairs");
  assert.ok(
    review > 0 && stop > review,
    "the stop step comes after the review",
  );
  assert.doesNotMatch(
    wf,
    /for pkg in[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*no live pair, its cert harness/,
    "the old per-package loop is gone",
  );
});
