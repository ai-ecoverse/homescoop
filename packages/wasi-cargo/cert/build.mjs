const FILES = {
  'Cargo.toml': '[workspace]\nmembers = ["app", "util"]\nresolver = "2"\n',
  'util/Cargo.toml': '[package]\nname = "util"\nversion = "0.1.0"\nedition = "2021"\n',
  'util/src/lib.rs': 'pub fn triangle(n: u64) -> u64 { (1..=n).sum() }\n',
  'app/Cargo.toml': '[package]\nname = "app"\nversion = "0.2.0"\nedition = "2021"\nbuild = "build.rs"\n\n[dependencies]\nutil = { path = "../util" }\n',
  'app/build.rs': [
    'fn main() {',
    '    let out = std::env::var("OUT_DIR").unwrap();',
    '    let n: u64 = std::fs::read_to_string("count.txt").unwrap().trim().parse().unwrap();',
    '    std::fs::write(format!("{out}/gen.rs"), format!("pub const COUNT: u64 = {n};\\n")).unwrap();',
    '    println!("cargo:rerun-if-changed=count.txt");',
    '    println!("cargo:rustc-env=APP_BUILT_BY=build.rs");',
    '}',
    '',
  ].join('\n'),
  'app/count.txt': '12\n',
  'app/src/main.rs': [
    'include!(concat!(env!("OUT_DIR"), "/gen.rs"));',
    'fn main() {',
    '    println!("count={} triangle={} by={}", COUNT, util::triangle(COUNT), env!("APP_BUILT_BY"));',
    '}',
    '',
  ].join('\n'),
};

export default async function (ctx) {
  const { run, write, readBytes, assert } = ctx;
  const W = '/home/ws';
  for (const [path, text] of Object.entries(FILES)) await write(`home/ws/${path}`, text);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;

  let r = await run(['cargo', '--version'], { cwd: W });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /^cargo 1\.98\.\d+ \(797e8a9bc /, out(r));

  r = await run(['cargo', 'build', '--offline', '--release'], { cwd: W });
  assert.equal(r.status, 0, `cargo build --offline --release: ${out(r)}`);
  assert.match(r.stderr, /Compiling util v0\.1\.0/, out(r));
  assert.match(r.stderr, /Compiling app v0\.2\.0/, out(r));
  assert.match(r.stderr, /Finished `release` profile/, out(r));
  const bin = `${W}/target/wasm32-wasip1/release/app.wasm`;
  r = await run([bin], { cwd: W });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'count=12 triangle=78 by=build.rs\n');
  const bytes = await readBytes(bin.slice(1));
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  assert.deepEqual(imports.filter((i) => i.module !== 'wasi_snapshot_preview1'), [], 'app.wasm imports only preview1');
  console.log(`app.wasm ${bytes.length} bytes, imports ${[...new Set(imports.map((i) => i.name))].sort().join(',')}`);

  r = await run(['cargo', 'build', '--offline', '--release'], { cwd: W });
  assert.equal(r.status, 0, out(r));
  assert.doesNotMatch(r.stderr, /Compiling/, `a second build is fresh: ${out(r)}`);

  await write('home/ws/app/count.txt', '20\n');
  r = await run(['cargo', 'run', '--offline', '--release', '-p', 'app'], { cwd: W });
  assert.equal(r.status, 0, `cargo run after count.txt changed: ${out(r)}`);
  assert.match(r.stderr, /Compiling app v0\.2\.0/, `build.rs reran: ${out(r)}`);
  assert.equal(r.stdout, 'count=20 triangle=210 by=build.rs\n');

  await write('home/ws/util/src/lib.rs', 'pub fn triangle(n: u64) -> u64 { n * "x" }\n');
  r = await run(['cargo', 'build', '--offline', '--release'], { cwd: W });
  assert.equal(r.status, 101, `a type error fails the build: ${out(r)}`);
  assert.match(r.stderr, /error\[E0277\]: cannot multiply `u64` by `&str`/, out(r));
}
