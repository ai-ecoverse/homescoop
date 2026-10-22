import { php, phpOk } from './lib/php.mjs';

const MSG = 'Maximum call stack size of 409600 bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?';

const DEEP = {
  serialize: '$a = []; for ($i = 0; $i < $d; $i++) $a = [$a]; $r = unserialize(serialize($a)) === $a ? "ok" : "?";',
  objects: '$o = null; for ($i = 0; $i < $d; $i++) { $n = new stdClass; $n->next = $o; $o = $n; } $s = serialize($o); $r = serialize(unserialize($s)) === $s ? "ok" : "?";',
  compare: '$a = []; $b = []; for ($i = 0; $i < $d; $i++) { $a = [$a]; $b = [$b]; } $r = $a == $b ? "ok" : "?";',
  json: '$a = []; for ($i = 0; $i < $d; $i++) $a = [$a]; $j = json_encode($a, 0, $d + 10); $r = $j === false ? json_last_error_msg() : (json_decode($j, true, $d + 10) === $a ? "ok" : "?");',
  array_map: 'function f($n) { return $n ? array_map("f", [$n - 1])[0] + 1 : 0; } $r = f($d) === $d ? "ok" : "?";',
  usort: 'function g($n) { if ($n) { $q = [2, 1]; usort($q, function ($x, $y) use ($n) { g($n - 1); return $x <=> $y; }); } return $n; } $r = g($d) === $d ? "ok" : "?";',
  get: 'class G { function __get($n) { return $n ? $this->{$n - 1} + 1 : 0; } } $r = (new G)->{$d} === $d ? "ok" : "?";',
  tostring: 'class T { function __construct(public $n) {} function __toString(): string { return $this->n ? "<" . new T($this->n - 1) . ">" : "x"; } } $r = strlen((string)new T($d)) === 2 * $d + 1 ? "ok" : "?";',
};

const INFINITE = {
  serialize: '$a = []; for ($i = 0; $i < 5000; $i++) $a = [$a]; serialize($a);',
  array_map: 'function f($n) { return array_map("f", [$n + 1]); } f(0);',
  usort: 'function g($n) { $q = [2, 1]; usort($q, function ($x, $y) use ($n) { g($n + 1); return $x <=> $y; }); } g(0);',
  get: 'class G { function __get($n) { return $this->{$n + 1}; } } (new G)->{0};',
  tostring: 'class T { function __toString(): string { return "<" . new T . ">"; } } echo new T;',
  preg: 'function p($n) { return preg_replace_callback("/a/", fn($m) => p($n + 1), "a"); } p(0);',
  offset: 'class A implements ArrayAccess { function offsetGet($o): mixed { return $this[$o + 1]; } function offsetExists($o): bool { return true; } function offsetSet($o, $v): void {} function offsetUnset($o): void {} } (new A)[0];',
  destruct: 'class D { function __destruct() { $x = new D; } } new D;',
};

export default async function (ctx) {
  const { run, assert } = ctx;

  const repro = await run(['php', '-r', '$a=[]; for($i=0;$i<5000;$i++) $a=[$a]; echo strlen(serialize($a)), "\\n";'], { cwd: '/tmp' });
  assert.equal(repro.status, 255, repro.stdout + repro.stderr);
  assert.match(repro.stdout, /Fatal error: Uncaught Error: Maximum call stack size of 409600 bytes \(zend\.max_allowed_stack_size - zend\.reserved_stack_size\) reached\. Infinite recursion\? in Command line code:1\n/, repro.stdout);
  assert.doesNotMatch(repro.stderr, /RangeError/);

  const ini = await phpOk(ctx, '<?php echo ini_get("zend.max_allowed_stack_size"), "|", ini_get("zend.reserved_stack_size"), "\\n";');
  assert.equal(ini, '0|0\n');

  for (const [name, code] of Object.entries(INFINITE)) {
    const r = await php(ctx, `<?php register_shutdown_function(fn() => print("shutdown\\n"));
try { ${code} echo "returned\\n"; } catch (Error $e) { echo get_class($e), ": ", $e->getMessage(), "\\n"; }
echo "after ", array_sum(array_map(fn($x) => $x, range(1, 100))), "\\n";`);
    assert.equal(r.status, 0, `${name}: rc ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.stdout, `Error: ${MSG}\nafter 5050\nshutdown\n`, name);
    assert.doesNotMatch(r.stderr, /RangeError/, name);
  }

  const cmp = await phpOk(ctx, `<?php $a = []; $b = []; for ($i = 0; $i < 5000; $i++) { $a = [$a]; $b = [$b]; }
try { var_dump($a == $b); } catch (Error $e) { echo get_class($e), ": ", $e->getMessage(), "\\n"; }
$j = json_encode($a, 0, 10000); echo var_export($j, true), " ", json_last_error_msg(), "\\n";`);
  assert.equal(cmp, 'Error: Maximum call stack size reached during comparison\nfalse Maximum stack depth exceeded\n');

  const uncaught = await php(ctx, '<?php function f($n) { return array_map("f", [$n + 1]); } f(0);');
  assert.equal(uncaught.status, 255, uncaught.stderr);
  assert.match(uncaught.stdout, /Fatal error: Uncaught Error: Maximum call stack size of 409600 bytes .* reached\. Infinite recursion\? in \/tmp\/php-cert\/s\d+-\d+\.php:1\nStack trace:\n#0 /, uncaught.stdout);
  assert.doesNotMatch(uncaught.stderr, /RangeError/);

  const fork = await phpOk(ctx, `<?php function f($n) { return array_map("f", [$n + 1]); }
$pid = pcntl_fork();
if ($pid === 0) { try { f(0); } catch (Error $e) { echo "child ", $e->getMessage() === "${MSG}" ? "error" : $e->getMessage(), "\\n"; } exit(3); }
pcntl_waitpid($pid, $st); echo "parent ", pcntl_wexitstatus($st), "\\n";`);
  assert.equal(fork, 'child error\nparent 3\n');

  for (const [name, code] of Object.entries(DEEP)) {
    const out = await phpOk(ctx, `<?php $d = 100; ${code} echo $r, "\\n";`);
    assert.equal(out, 'ok\n', `${name} at depth 100`);
  }
  assert.equal(await phpOk(ctx, '<?php function u($n) { return $n ? u($n - 1) + 1 : 0; } echo u(50000), "\\n";'), '50000\n');
  assert.equal(await phpOk(ctx, '<?php $s = str_repeat("a:1:{i:0;", 1000) . "i:1;" . str_repeat("}", 1000); $v = unserialize($s); for ($i = 0; $i < 1000; $i++) $v = $v[0]; echo $v, "\\n";'), '1\n');

  const lower = await php(ctx, '<?php function f($n) { return $n ? array_map("f", [$n - 1])[0] + 1 : 0; } try { echo f(100), "\\n"; } catch (Error $e) { echo $e->getMessage(), "\\n"; }', { flags: ['-d', 'zend.max_allowed_stack_size=128K'] });
  assert.equal(lower.stdout, 'Maximum call stack size of 81920 bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?\n', lower.stderr);
}
