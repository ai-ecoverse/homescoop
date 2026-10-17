const PREVIEW1 = new Set([
  'args_get', 'args_sizes_get', 'environ_get', 'environ_sizes_get', 'clock_res_get', 'clock_time_get',
  'fd_advise', 'fd_allocate', 'fd_close', 'fd_datasync', 'fd_fdstat_get', 'fd_fdstat_set_flags',
  'fd_fdstat_set_rights', 'fd_filestat_get', 'fd_filestat_set_size', 'fd_filestat_set_times', 'fd_pread',
  'fd_prestat_get', 'fd_prestat_dir_name', 'fd_pwrite', 'fd_read', 'fd_readdir', 'fd_renumber', 'fd_seek',
  'fd_sync', 'fd_tell', 'fd_write', 'path_create_directory', 'path_filestat_get', 'path_filestat_set_times',
  'path_link', 'path_open', 'path_readlink', 'path_remove_directory', 'path_rename', 'path_symlink',
  'path_unlink_file', 'poll_oneoff', 'proc_exit', 'proc_raise', 'sched_yield', 'random_get', 'sock_accept',
  'sock_recv', 'sock_send', 'sock_shutdown',
]);

const FILES = {
  'hello/hello.rs': 'fn main() { println!("hello from rustc"); }\n',
  'std/main.rs': [
    'use std::io::Write;',
    'fn main() {',
    '    let dir = std::env::var("OUT").expect("OUT");',
    '    let path = std::path::Path::new(&dir).join("note.txt");',
    '    let mut f = std::fs::File::create(&path).unwrap();',
    '    writeln!(f, "args={:?}", std::env::args().skip(1).collect::<Vec<_>>()).unwrap();',
    '    drop(f);',
    '    let text = std::fs::read_to_string(&path).unwrap();',
    '    print!("{text}");',
    '    let mut v: Vec<u64> = (1..=20).map(|n| n * n).collect();',
    '    v.sort_by(|a, b| b.cmp(a));',
    '    println!("sum={} first={}", v.iter().sum::<u64>(), v[0]);',
    '    std::process::exit(7);',
    '}',
    '',
  ].join('\n'),
  'dep/greet/lib.rs': [
    'pub struct Greeter { pub name: String }',
    'impl Greeter {',
    '    pub fn new(name: &str) -> Self { Greeter { name: name.to_string() } }',
    '    pub fn hello(&self) -> String { format!("hello, {}!", self.name) }',
    '}',
    'pub fn fib(n: u32) -> u64 { if n < 2 { n as u64 } else { fib(n - 1) + fib(n - 2) } }',
    '',
  ].join('\n'),
  'dep/app/main.rs': [
    'use greet::{fib, Greeter};',
    'fn main() {',
    '    println!("{}", Greeter::new("slicc").hello());',
    '    println!("fib(25)={}", fib(25));',
    '}',
    '',
  ].join('\n'),
  'panic/main.rs': 'fn main() { let v: Vec<u8> = Vec::new(); let i = std::env::args().count() + 2; println!("{}", v[i]); }\n',
};

export default async function (ctx) {
  const { run, write, readBytes, assert } = ctx;
  const R = '/home/corpus';
  for (const [path, text] of Object.entries(FILES)) await write(`home/corpus/${path}`, text);
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const rustc = async (args, cwd) => {
    const r = await run(['rustc', ...args], { cwd });
    assert.equal(r.status, 0, `rustc ${args.join(' ')}: ${out(r)}`);
    return r;
  };
  const sizes = {};
  const imports = {};
  const inspect = async (name, path) => {
    const bytes = await readBytes(path.slice(1));
    assert.ok(bytes && bytes.length > 0, `${path} written`);
    sizes[name] = bytes.length;
    const mod = new WebAssembly.Module(bytes);
    const list = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`);
    imports[name] = list;
    const bad = WebAssembly.Module.imports(mod).filter((i) => i.module !== 'wasi_snapshot_preview1' || !PREVIEW1.has(i.name));
    assert.deepEqual(bad, [], `${name} imports only wasi_snapshot_preview1: ${list.join(', ')}`);
    assert.ok(WebAssembly.Module.exports(mod).some((e) => e.name === '_start'), `${name} exports _start`);
  };

  const v = await run(['rustc', '--version'], { cwd: R });
  assert.equal(v.status, 0, out(v));
  assert.match(v.stdout, /^rustc 1\.98\.1(-dev)?\b/);
  const vv = await run(['rustc', '-vV'], { cwd: R });
  assert.match(vv.stdout, /^host: wasm32-wasip1-threads$/m, out(vv));
  assert.match(vv.stdout, /^LLVM version: 21\.1\.8$/m, out(vv));

  await rustc(['hello.rs', '-o', 'hello.wasm'], `${R}/hello`);
  let r = await run([`${R}/hello/hello.wasm`], { cwd: `${R}/hello` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'hello from rustc\n');
  await inspect('hello', `${R}/hello/hello.wasm`);

  await rustc(['-O', 'main.rs', '-o', 'std.wasm'], `${R}/std`);
  r = await run(['bash', '-c', `OUT=${R}/std ${R}/std/std.wasm a 'b c'`], { cwd: `${R}/std` });
  assert.equal(r.status, 7, `process::exit(7): ${out(r)}`);
  assert.equal(r.stdout, 'args=["a", "b c"]\nsum=2870 first=400\n', out(r));
  await inspect('std', `${R}/std/std.wasm`);

  await rustc(['--crate-type', 'rlib', '--crate-name', 'greet', '--edition', '2021', '-O', 'lib.rs', '-o', 'libgreet.rlib'], `${R}/dep/greet`);
  await rustc(['--edition', '2021', '-O', 'main.rs', '--extern', `greet=${R}/dep/greet/libgreet.rlib`, '-o', 'app.wasm'], `${R}/dep/app`);
  r = await run([`${R}/dep/app/app.wasm`], { cwd: `${R}/dep/app` });
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, 'hello, slicc!\nfib(25)=75025\n');
  await inspect('dep', `${R}/dep/app/app.wasm`);

  await rustc(['main.rs', '-o', 'panic.wasm'], `${R}/panic`);
  r = await run([`${R}/panic/panic.wasm`], { cwd: `${R}/panic` });
  assert.notEqual(r.status, 0, `an out-of-bounds index panics: ${out(r)}`);
  assert.match(r.stderr, /index out of bounds: the len is 0 but the index is 3/, out(r));

  const bad = await run(['rustc', 'main.rs', '-o', 'x.wasm'], { cwd: `${R}/hello` });
  assert.equal(bad.status, 1, `a missing source fails: ${out(bad)}`);
  await write('home/corpus/err/main.rs', 'fn main() { let x: u32 = "no"; }\n');
  const typeErr = await run(['rustc', 'main.rs'], { cwd: `${R}/err` });
  assert.equal(typeErr.status, 1, out(typeErr));
  assert.match(typeErr.stderr, /error\[E0308\]: mismatched types/, out(typeErr));

  console.log(`corpus sizes ${JSON.stringify(sizes)}`);
  console.log(`corpus imports ${JSON.stringify(Object.fromEntries(Object.entries(imports).map(([k, l]) => [k, [...new Set(l)].sort()])))}`);
}
