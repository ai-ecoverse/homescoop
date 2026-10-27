import { olderThan, recipeVersion } from './lib/version.mjs';

export const REVERTED_IN = '0.13.3';
export const FIXED_IN = '0.13.5';
export const SPURIOUS = "leaf-c==1.0.0 ; sys_platform != 'linux'";
export const COMMAND = 'uv export --extra feature --frozen --no-header --no-annotate --no-hashes';

const CRASH = /panicked|wasm trap|unreachable|RuntimeError/;

const CORRECT = [
  "bridge==1.0.0 ; sys_platform == 'linux'",
  'leaf-b==1.0.0',
  "shared==1.0.0 ; sys_platform == 'linux'",
  "shared==2.0.0 ; sys_platform != 'linux'",
];

export const PYPROJECT = `[project]
name = "root"
version = "0.1.0"
requires-python = ">=3.9"
dependencies = [
    "shared==1.0.0 ; sys_platform == 'linux'",
    "shared==2.0.0 ; sys_platform != 'linux'",
]

[project.optional-dependencies]
feature = ["bridge==1.0.0 ; sys_platform == 'linux'"]
`;

export const LOCK = `version = 1
revision = 3
requires-python = ">=3.9"

[manifest]
members = ["root"]

[[package]]
name = "root"
version = "0.1.0"
source = { virtual = "." }
dependencies = [
    { name = "shared", version = "1.0.0", source = { registry = "https://example.com/simple" }, marker = "sys_platform == 'linux'" },
    { name = "shared", version = "2.0.0", source = { registry = "https://other.example/simple" }, marker = "sys_platform != 'linux'" },
]

[package.optional-dependencies]
feature = [{ name = "bridge", version = "1.0.0", source = { registry = "https://example.com/simple" }, marker = "sys_platform == 'linux'" }]

[package.metadata]
provides-extras = ["feature"]

[[package]]
name = "bridge"
version = "1.0.0"
source = { registry = "https://example.com/simple" }
dependencies = [
    { name = "shared", version = "1.0.0", source = { registry = "https://example.com/simple" }, marker = "sys_platform == 'linux'", extra = ["a"] },
    { name = "shared", version = "2.0.0", source = { registry = "https://other.example/simple" }, marker = "sys_platform != 'linux'", extra = ["a"] },
]

[[package]]
name = "shared"
version = "1.0.0"
source = { registry = "https://example.com/simple" }
resolution-markers = ["sys_platform == 'linux'"]

[package.optional-dependencies]
a = [{ name = "leaf-b", version = "1.0.0", source = { registry = "https://example.com/simple" } }]

[package.metadata]
provides-extras = ["a"]

[[package]]
name = "shared"
version = "2.0.0"
source = { registry = "https://other.example/simple" }
resolution-markers = ["sys_platform != 'linux'"]
dependencies = [{ name = "leaf-b", version = "1.0.0", source = { registry = "https://example.com/simple" } }]

[package.optional-dependencies]
a = [{ name = "leaf-c", version = "1.0.0", source = { registry = "https://example.com/simple" } }]

[package.metadata]
provides-extras = ["a"]

[[package]]
name = "leaf-b"
version = "1.0.0"
source = { registry = "https://example.com/simple" }

[[package]]
name = "leaf-c"
version = "1.0.0"
source = { registry = "https://example.com/simple" }
`;

export const exportsSpurious = (version) => !olderThan(version, REVERTED_IN) && olderThan(version, FIXED_IN);

export function expectedExport (version) {
  return `${[...CORRECT, ...(exportsSpurious(version) ? [SPURIOUS] : [])].sort().join('\n')}\n`;
}

export function checkExport (assert, r, version) {
  const why = exportsSpurious(version)
    ? `exports ${SPURIOUS}: astral-sh/uv#22750 reverted the fix, astral-sh/uv#22751 restores it in ${FIXED_IN} (homescoop#1920)`
    : 'exports no leaf-c: the extra that adds it has no compatible activation path';
  assert.doesNotMatch(r.stderr, CRASH, `${COMMAND}: uv's own output, not a crash: rc=${r.status}\nstderr=${r.stderr}`);
  assert.equal(r.status, 0, `${COMMAND}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.equal(r.stdout, expectedExport(version), `${COMMAND} on uv ${version} ${why}`);
  return why;
}

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const version = recipeVersion();
  const env = { UV_NO_CONFIG: '1', UV_OFFLINE: '1' };
  const mk = await run(['bash', '-c', 'mkdir -p /home/x'], { cwd: '/home', env });
  assert.equal(mk.status, 0, `mkdir /home/x: ${mk.stderr}`);
  await write('/home/x/pyproject.toml', PYPROJECT);
  await write('/home/x/uv.lock', LOCK);
  console.log(`wasi-uv: /home/x$ ${COMMAND}`);
  const r = await run(['bash', '-c', COMMAND], { cwd: '/home/x', env });
  const why = checkExport(assert, r, version);
  console.log(`export: uv ${version} ${why}`);
}
