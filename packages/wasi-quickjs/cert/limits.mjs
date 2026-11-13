export default async function (ctx) {
  const { run, assert } = ctx;
  const out = (label, r) => `${label}: rc=${r.status}\n--- stdout\n${String(r.stdout).slice(0, 600)}\n--- stderr\n${String(r.stderr).slice(0, 600)}`;
  const absent = {
    std: ['popen', 'tmpfile', 'urlGet'],
    os: ['exec', 'getpid', 'waitpid', 'pipe', 'kill', 'dup', 'dup2', 'symlink', 'readlink', 'lstat', 'realpath', 'ttyGetWinSize', 'ttySetRaw', 'mkdtemp', 'mkstemp', 'cputime', 'Worker', 'SIGQUIT', 'SIGPIPE', 'SIGALRM', 'SIGUSR1', 'SIGCHLD', 'WNOHANG'],
  };
  const present = {
    std: ['open', 'fdopen', 'loadFile', 'writeFile', 'getenv', 'setenv', 'unsetenv', 'getenviron', 'exit', 'evalScript', 'loadScript', 'strerror', 'in', 'out', 'err'],
    os: ['open', 'close', 'read', 'write', 'seek', 'isatty', 'remove', 'rename', 'readdir', 'stat', 'utimes', 'mkdir', 'getcwd', 'chdir', 'sleep', 'sleepAsync', 'setTimeout', 'clearTimeout', 'setInterval', 'setReadHandler', 'signal', 'now', 'exePath', 'SIGINT', 'SIGTERM'],
  };
  const script = `import * as std from "qjs:std"; import * as os from "qjs:os";
const m = { std, os };
console.log(JSON.stringify({
  platform: os.platform,
  absent: Object.fromEntries(Object.entries(${JSON.stringify(absent)}).map(([k, v]) => [k, v.filter((n) => n in m[k])])),
  missing: Object.fromEntries(Object.entries(${JSON.stringify(present)}).map(([k, v]) => [k, v.filter((n) => !(n in m[k]))])),
}));`;
  let r = await run(['qjs', '-e', script], { cwd: '/home' });
  assert.equal(r.status, 0, out('qjs:std and qjs:os on WASI', r));
  assert.deepEqual(JSON.parse(r.stdout), { platform: 'wasi', absent: { std: [], os: [] }, missing: { std: [], os: [] } }, out('qjs:std and qjs:os on WASI', r));

  r = await run(['qjs', '-c', 'x.js', '-o', 'y'], { cwd: '/home' });
  assert.equal(r.status, 1, out('qjs -c (no standalone executables on WASI)', r));
  assert.match(r.stderr, /^qjs: unknown option '-c'\n/, out('qjs -c', r));
  r = await run(['bash', '-c', 'command -v qjsc; echo "rc=$?"'], { cwd: '/home' });
  assert.equal(r.stdout, 'rc=1\n', out('no qjsc command', r));
  r = await run(['qjs', '-e', 'import * as os from "qjs:os"; const fd = os.open("/tmp/qjs-fd.txt", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644); const b = new Uint8Array([111, 107, 10]); console.log(os.write(fd, b.buffer, 0, 3), os.close(fd), os.isatty(0), os.isatty(1))'], { cwd: '/home' });
  assert.equal(r.stdout, '3 0 false false\n', out('os.open/write/close/isatty', r));
  r = await run(['qjs', '-e', 'import * as std from "qjs:std"; std.setenv("QJS_X", "1"); console.log(std.getenv("QJS_X"), std.getenv("NOPE"), typeof std.getenviron().PATH)'], { cwd: '/home' });
  assert.equal(r.stdout, '1 undefined string\n', out('std.setenv/getenv/getenviron', r));
  r = await run(['qjs', '--memory-limit', '4096', '-e', 'const a = []; for (;;) a.push(new Array(1e5).fill(1));'], { cwd: '/home' });
  assert.equal(r.status, 1, out('--memory-limit', r));
  assert.match(r.stderr, /^InternalError: out of memory\n/, out('--memory-limit', r));
  r = await run(['qjs', '-e', 'function f(n) { return n ? 1 + f(n - 1) : 0 } try { f(1e7) } catch (e) { console.log(e instanceof RangeError, String(e)) } console.log(f(500))'], { cwd: '/home' });
  assert.equal(r.status, 0, out('deep recursion (0003)', r));
  assert.equal(r.stdout, 'true RangeError: Maximum call stack size exceeded\n500\n', out('deep recursion (0003)', r));
  r = await run(['qjs', '-e', 'let o = []; for (let i = 0; i < 1000; i++) o = [o]; const s = JSON.stringify(o); console.log(s.length, JSON.stringify(JSON.parse(s)) === s)'], { cwd: '/home' });
  assert.equal(r.stdout, '2002 true\n', out('JSON nested 1000 deep', r));
  console.log('limits: qjs:os has no processes, pipes, dup, links, realpath, tty raw mode, temp files, cputime or Worker; std has no popen, tmpfile or urlGet; no -c and no qjsc; --memory-limit and the stack limit throw');
}
