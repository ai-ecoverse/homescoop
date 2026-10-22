/**
 * patches/0003: zend_try/zend_bailout are setjmp/longjmp (WASIX stack
 * snapshots through asyncify). A fatal error anywhere unwinds to the
 * executor: shutdown functions and destructors still run, output buffers
 * flush, and the exit status is 255. exit() from deep in a call stack,
 * memory_limit and max_execution_time take the same path.
 */
import { php } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  const fatal = await php(ctx, `<?php
register_shutdown_function(function () { $e = error_get_last(); echo "shutdown: ", $e ? $e["message"] : "none", "\\n"; });
class D { function __destruct() { echo "destructor\\n"; } }
$d = new D;
ob_start(); echo "buffered\\n";
function deep($n) { return $n ? deep($n - 1) : array_map(fn($x) => undefined_function($x), [1]); }
try { deep(50); } finally { echo "finally runs\\n"; }
echo "unreached\\n";
`);
  assert.equal(fatal.status, 255, fatal.stderr);
  assert.match(fatal.stdout, /^buffered\nfinally runs\nPHP Fatal error|^buffered\nfinally runs\n\nFatal error: Uncaught Error: Call to undefined function undefined_function\(\)/);
  assert.match(fatal.stdout, /shutdown: Uncaught Error: Call to undefined function undefined_function\(\)/);
  assert.doesNotMatch(fatal.stdout, /unreached/);

  // A fatal error raised from C (not an exception) is a real bailout.
  const limit = await php(ctx, `<?php
ini_set("memory_limit", "16M");
register_shutdown_function(function () { echo "shutdown after: ", error_get_last()["message"] ?? "none", "\\n"; });
$a = []; while (true) { $a[] = str_repeat("x", 1 << 16); }
`);
  assert.equal(limit.status, 255, limit.stderr);
  assert.match(limit.stdout, /Fatal error: Allowed memory size of 16777216 bytes exhausted/);
  assert.match(limit.stdout, /shutdown after: Allowed memory size of 16777216 bytes exhausted/);

  const timeout = await php(ctx, `<?php
set_time_limit(1);
register_shutdown_function(function () { echo "shutdown: timeout\\n"; });
$t = microtime(true); while (true) { if (microtime(true) - $t > 10) { echo "no timeout\\n"; break; } }
`);
  assert.equal(timeout.status, 255, timeout.stdout + timeout.stderr);
  assert.match(timeout.stdout, /Fatal error: Maximum execution time of 1 second exceeded/);
  assert.match(timeout.stdout, /shutdown: timeout/);

  // exit() deep in a callback stack, with its status; nested error handlers.
  const ex = await php(ctx, `<?php
register_shutdown_function(fn() => print("bye\\n"));
set_error_handler(function ($no, $str) { echo "handled: $str\\n"; return true; });
trigger_error("custom", E_USER_WARNING);
$x = [3, 1, 2];
usort($x, function ($a, $b) { (function () { array_map(function () { exit(4); }, [1]); })(); });
`);
  assert.equal(ex.status, 4, ex.stderr);
  assert.equal(ex.stdout, 'handled: custom\nbye\n');

  // A user error handler that throws, caught several frames up, many times over.
  const loop = await php(ctx, `<?php
set_error_handler(function ($no, $str) { throw new ErrorException($str, 0, $no); });
$n = 0; for ($i = 0; $i < 2000; $i++) { try { $x = [] ; $x["missing"]; } catch (ErrorException $e) { $n++; } }
echo $n, "\\n";
for ($i = 0; $i < 200; $i++) { try { eval("syntax error here"); } catch (ParseError $e) { $n++; } }
echo $n, "\\n";
`);
  assert.equal(loop.status, 0, loop.stdout + loop.stderr);
  assert.equal(loop.stdout, '2000\n2200\n');
}
