import { php, phpOk } from './lib/php.mjs';

const BUDGET = 2048000;
const MSG = `Maximum call stack size of ${BUDGET} bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?`;
const CMP = 'Maximum call stack size reached during comparison';
const OBJ_CMP = 'Maximum call stack size reached during object comparison';
const DOM = 'Maximum call stack size reached. Infinite recursion?';

const NEST = '$a = []; for ($i = 0; $i < $d; $i++) $a = [$a];';
const LIST = '$o = null; for ($i = 0; $i < $d; $i++) { $n = new stdClass; $n->next = $o; $o = $n; }';
const TREE = '$x = new DOMDocument; $e = $x; for ($i = 0; $i < $d; $i++) $e = $e->appendChild($x->createElement("a"));';

const DEEP = [
  ['serialize', 500, `${NEST} $r = unserialize(serialize($a)) === $a ? "ok" : "?";`],
  ['serialize objects', 500, `${LIST} $s = serialize($o); $r = serialize(unserialize($s)) === $s ? "ok" : "?";`],
  ['== arrays', 500, '$a = []; $b = []; for ($i = 0; $i < $d; $i++) { $a = [$a]; $b = [$b]; } $r = $a == $b ? "ok" : "?";'],
  ['== objects', 200, '$a = null; $b = null; for ($i = 0; $i < $d; $i++) { $n = new stdClass; $n->next = $a; $a = $n; $m = new stdClass; $m->next = $b; $b = $m; } $r = $a == $b ? "ok" : "?";'],
  ['== declared properties', 500, 'class N { public $next; } $a = null; $b = null; for ($i = 0; $i < $d; $i++) { $n = new N; $n->next = $a; $a = $n; $m = new N; $m->next = $b; $b = $m; } $r = $a == $b ? "ok" : "?";'],
  ['json_encode', 500, `${NEST} $j = json_encode($a, 0, $d + 10); $r = $j === false ? json_last_error_msg() : (json_decode($j, true, $d + 10) === $a ? "ok" : "?");`],
  ['json_encode objects', 500, `${LIST} $j = json_encode($o, 0, $d + 10); $r = $j === false ? json_last_error_msg() : (strlen($j) > $d ? "ok" : "?");`],
  ['array_map', 500, 'function f($n) { return $n ? array_map("f", [$n - 1])[0] + 1 : 0; } $r = f($d) === $d ? "ok" : "?";'],
  ['array_walk_recursive', 500, '$a = [1]; for ($i = 0; $i < $d; $i++) $a = [$a]; $c = 0; array_walk_recursive($a, function ($v) use (&$c) { $c++; }); $r = $c === 1 ? "ok" : "?";'],
  ['var_dump', 200, `${NEST} ob_start(); var_dump($a); $v = ob_get_clean(); $r = !str_contains($v, "nesting level too deep") && substr_count($v, "array(1)") === $d ? "ok" : "?";`],
  ['__toString', 200, 'class T { function __construct(public $n) {} function __toString(): string { return $this->n ? "<" . new T($this->n - 1) . ">" : "x"; } } $r = strlen((string)new T($d)) === 2 * $d + 1 ? "ok" : "?";'],
  ['usort', 150, 'function g($n) { if ($n) { $q = [2, 1]; usort($q, function ($x, $y) use ($n) { g($n - 1); return $x <=> $y; }); } return $n; } $r = g($d) === $d ? "ok" : "?";'],
  ['__get', 300, 'class G { function __get($n) { return $n ? $this->{$n - 1} + 1 : 0; } } $r = (new G)->{$d} === $d ? "ok" : "?";'],
  ['preg_replace_callback', 200, 'function p($n) { return $n ? preg_replace_callback("/a/", fn($m) => p($n - 1), "a") : "b"; } $r = p($d) === "b" ? "ok" : "?";'],
  ['ArrayAccess', 300, 'class A implements ArrayAccess { function offsetGet($o): mixed { return $o ? $this[$o - 1] + 1 : 0; } function offsetExists($o): bool { return true; } function offsetSet($o, $v): void {} function offsetUnset($o): void {} } $r = (new A)[$d] === $d ? "ok" : "?";'],
  ['count', 500, `${NEST} $r = count($a, COUNT_RECURSIVE) === $d ? "ok" : "?";`],
  ['http_build_query', 500, '$a = ["x" => 1]; for ($i = 0; $i < $d; $i++) $a = ["a" => $a]; $r = strlen(http_build_query($a)) > $d ? "ok" : "?";'],
  ['DOMDocument::saveXML', 500, `${TREE} $r = strlen($x->saveXML()) > $d ? "ok" : "?";`],
];

const INFINITE = [
  ['serialize', MSG, '$a = []; for ($i = 0; $i < 5000; $i++) $a = [$a]; serialize($a);'],
  ['__serialize', MSG, 'class U { function __construct(public $n) {} function __serialize(): array { return [new U($this->n + 1)]; } function __unserialize(array $a): void {} } serialize(new U(0));'],
  ['array_map', MSG, 'function f($n) { return array_map("f", [$n + 1]); } f(0);'],
  ['array_filter', MSG, 'function k($n) { return array_filter([$n + 1], fn($v) => k($v)); } k(0);'],
  ['array_reduce', MSG, 'function r($n) { return array_reduce([1], fn($c, $v) => r($n + 1), 0); } r(0);'],
  ['array_walk', MSG, 'function w($n) { $q = [1]; array_walk($q, function () use ($n) { w($n + 1); }); } w(0);'],
  ['usort', MSG, 'function g($n) { $q = [2, 1]; usort($q, function ($x, $y) use ($n) { g($n + 1); return $x <=> $y; }); } g(0);'],
  ['uasort', MSG, 'function g($n) { $q = [2, 1]; uasort($q, function ($x, $y) use ($n) { g($n + 1); return $x <=> $y; }); } g(0);'],
  ['uksort', MSG, 'function g($n) { $q = [2 => 1, 1 => 2]; uksort($q, function ($x, $y) use ($n) { g($n + 1); return $x <=> $y; }); } g(0);'],
  ['array_udiff', MSG, 'function g($n) { array_udiff([1], [2], function ($x, $y) use ($n) { g($n + 1); return $x <=> $y; }); } g(0);'],
  ['SplHeap::compare', MSG, 'class H extends SplMinHeap { protected function compare($a, $b): int { $h = new H; $h->insert(1); $h->insert(2); return $a <=> $b; } } $h = new H; $h->insert(1); $h->insert(2);'],
  ['__get', MSG, 'class G { function __get($n) { return $this->{$n + 1}; } } (new G)->{0};'],
  ['__set', MSG, 'class P { function __set($n, $v) { $this->{"p" . $v} = $v + 1; } } $p = new P; $p->q = 0;'],
  ['__isset', MSG, 'class I { function __isset($n) { return isset($this->{$n + 1}); } } isset((new I)->{0});'],
  ['__unset', MSG, 'class X { function __unset($n) { unset($this->{$n + 1}); } } $x = new X; unset($x->{0});'],
  ['__toString', MSG, 'class T { function __toString(): string { return "<" . new T . ">"; } } echo new T;'],
  ['Stringable argument', MSG, 'class S { function __toString(): string { return (string) mb_strlen(new S); } } mb_strlen(new S);'],
  ['preg_replace_callback', MSG, 'function p($n) { return preg_replace_callback("/a/", fn($m) => p($n + 1), "a"); } p(0);'],
  ['ArrayAccess::offsetGet', MSG, 'class A implements ArrayAccess { function offsetGet($o): mixed { return $this[$o + 1]; } function offsetExists($o): bool { return true; } function offsetSet($o, $v): void {} function offsetUnset($o): void {} } (new A)[0];'],
  ['ArrayAccess::offsetExists', MSG, 'class A implements ArrayAccess { function offsetGet($o): mixed { return 1; } function offsetExists($o): bool { return isset($this[$o + 1]); } function offsetSet($o, $v): void {} function offsetUnset($o): void {} } isset((new A)[0]);'],
  ['ArrayAccess::offsetSet', MSG, 'class A implements ArrayAccess { function offsetGet($o): mixed { return 1; } function offsetExists($o): bool { return true; } function offsetSet($o, $v): void { $this[$o + 1] = $v; } function offsetUnset($o): void {} } $a = new A; $a[0] = 1;'],
  ['__destruct', MSG, 'class D { function __destruct() { $x = new D; } } new D;'],
  ['IteratorAggregate', MSG, 'class It implements IteratorAggregate { function getIterator(): Iterator { return new ArrayIterator(iterator_to_array(new It)); } } iterator_to_array(new It);'],
  ['ReflectionFunction::invoke', MSG, 'function y($n) { return (new ReflectionFunction("y"))->invoke($n + 1); } y(0);'],
  ['count', MSG, '$a = []; for ($i = 0; $i < 5000; $i++) $a = [$a]; count($a, COUNT_RECURSIVE);'],
  ['array_walk_recursive', MSG, '$a = [1]; for ($i = 0; $i < 5000; $i++) $a = [$a]; array_walk_recursive($a, fn() => 0);'],
  ['array_replace_recursive', MSG, '$a = []; for ($i = 0; $i < 5000; $i++) $a = [$a]; array_replace_recursive($a, $a);'],
  ['compact', MSG, '$v = 1; $a = ["v"]; for ($i = 0; $i < 5000; $i++) $a = [$a]; compact($a);'],
  ['mb_convert_variables', MSG, '$a = "x"; for ($i = 0; $i < 5000; $i++) $a = [$a]; mb_convert_variables("UTF-8", "ASCII", $a);'],
  ['http_build_query', 'Maximum call stack size reached.', '$a = ["x" => 1]; for ($i = 0; $i < 5000; $i++) $a = ["a" => $a]; http_build_query($a);'],
  ['== arrays', CMP, '$a = []; $b = []; for ($i = 0; $i < 5000; $i++) { $a = [$a]; $b = [$b]; } $a == $b;'],
  ['=== arrays', CMP, '$a = []; $b = []; for ($i = 0; $i < 5000; $i++) { $a = [$a, 1]; $b = [$b, 1]; } $a === $b;'],
  ['== objects', CMP, '$a = null; $b = null; for ($i = 0; $i < 5000; $i++) { $n = new stdClass; $n->next = $a; $a = $n; $m = new stdClass; $m->next = $b; $b = $m; } $a == $b;'],
  ['== declared properties', OBJ_CMP, 'class N { public $next; } $a = null; $b = null; for ($i = 0; $i < 5000; $i++) { $n = new N; $n->next = $a; $a = $n; $m = new N; $m->next = $b; $b = $m; } $a == $b;'],
  ['DOMNode::isEqualNode', 'Maximum call stack size reached.', '$x = new DOMDocument; $e = $x; for ($i = 0; $i < 5000; $i++) $e = $e->appendChild($x->createElement("a")); $x->documentElement->isEqualNode($x->cloneNode(true)->documentElement);'],
  ['Dom\\XMLDocument::saveXml', DOM, '$x = Dom\\XMLDocument::createEmpty(); $e = $x; for ($i = 0; $i < 5000; $i++) $e = $e->appendChild($x->createElement("a")); $x->saveXml();'],
];

export default async function (ctx) {
  const { run, assert } = ctx;

  for (const [name, d, code] of DEEP) {
    const r = await php(ctx, `<?php $d = ${d}; try { ${code} } catch (Error $e) { $r = get_class($e) . ": " . $e->getMessage(); } echo $r, "\\n";`);
    assert.equal(r.stdout, 'ok\n', `${name} at depth ${d}: rc ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /RangeError/, name);
  }
  assert.equal(await phpOk(ctx, '<?php function u($n) { return $n ? u($n - 1) + 1 : 0; } echo u(50000), "\\n";'), '50000\n');
  assert.equal(await phpOk(ctx, '<?php $s = str_repeat("a:1:{i:0;", 1000) . "i:1;" . str_repeat("}", 1000); $v = unserialize($s); for ($i = 0; $i < 1000; $i++) $v = $v[0]; echo $v, "\\n";'), '1\n');

  const repro = await run(['php', '-r', '$a=[]; for($i=0;$i<5000;$i++) $a=[$a]; echo strlen(serialize($a)), "\\n";'], { cwd: '/tmp' });
  assert.equal(repro.status, 255, repro.stdout + repro.stderr);
  assert.ok(repro.stdout.includes(`Fatal error: Uncaught Error: ${MSG} in Command line code:1\n`), repro.stdout);
  assert.doesNotMatch(repro.stderr, /RangeError/);

  const ini = await phpOk(ctx, '<?php echo ini_get("zend.max_allowed_stack_size"), "|", ini_get("zend.reserved_stack_size"), "\\n";');
  assert.equal(ini, '0|0\n');

  for (const [name, msg, code] of INFINITE) {
    const r = await php(ctx, `<?php register_shutdown_function(fn() => print("shutdown\\n"));
try { ${code} echo "returned\\n"; } catch (Error $e) { echo get_class($e), ": ", $e->getMessage(), "\\n"; }
echo "after ", array_sum(array_map(fn($x) => $x, range(1, 100))), "\\n";`);
    assert.equal(r.status, 0, `${name}: rc ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.stdout, `Error: ${msg}\nafter 5050\nshutdown\n`, name);
    assert.doesNotMatch(r.stderr, /RangeError/, name);
  }

  const out = await phpOk(ctx, `<?php $a = []; for ($i = 0; $i < 5000; $i++) $a = [$a];
$j = json_encode($a, 0, 10000); echo var_export($j, true), " ", json_last_error_msg(), "\\n";
ob_start(); var_dump($a); $v = ob_get_clean(); echo str_contains($v, "nesting level too deep") ? "var_dump stops" : "var_dump ?", "\\n";
ob_start(); debug_zval_dump($a); $v = ob_get_clean(); echo str_contains($v, "nesting level too deep") ? "debug_zval_dump stops" : "debug_zval_dump ?", "\\n";
class J implements JsonSerializable { function jsonSerialize(): mixed { return [new J]; } }
try { $j = json_encode(new J, 0, 100000); echo var_export($j, true), " ", json_last_error_msg(), "\\n"; } catch (Error $e) { echo $e->getMessage(), "\\n"; }
$x = new DOMDocument; $e = $x; for ($i = 0; $i < 5000; $i++) { $e = $e->appendChild($x->createElement("a")); $e->appendChild($x->createTextNode("t")); $e->appendChild($x->createTextNode("u")); }
try { $x->normalize(); echo "normalized\\n"; } catch (Error $e) { echo $e->getMessage(), "\\n"; }`);
  assert.equal(out, `false Maximum stack depth exceeded\nvar_dump stops\ndebug_zval_dump stops\n${MSG}\n${DOM}\n`);

  for (const [name, code] of [
    ['nested calls', 'echo eval("return " . str_repeat("abs(", 2000) . "1" . str_repeat(")", 2000) . ";");'],
    ['a nested constant array', 'echo count(eval("return " . str_repeat("[", 2000) . str_repeat("]", 2000) . ";"));'],
  ]) {
    const r = await php(ctx, `<?php ${code}`);
    assert.equal(r.status, 255, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`Fatal error: Maximum call stack size of ${BUDGET} bytes \\(zend\\.max_allowed_stack_size - zend\\.reserved_stack_size\\) reached during compilation\\. Try splitting expression in `), name);
    assert.doesNotMatch(r.stderr, /RangeError/, name);
  }

  const uncaught = await php(ctx, '<?php function f($n) { return array_map("f", [$n + 1]); } f(0);');
  assert.equal(uncaught.status, 255, uncaught.stderr);
  assert.match(uncaught.stdout, /Fatal error: Uncaught Error: Maximum call stack size of 2048000 bytes .* reached\. Infinite recursion\? in \/tmp\/php-cert\/s\d+-\d+\.php:1\nStack trace:\n#0 /, uncaught.stdout);
  assert.doesNotMatch(uncaught.stderr, /RangeError/);

  const fork = await phpOk(ctx, `<?php function f($n) { return array_map("f", [$n + 1]); }
$pid = pcntl_fork();
if ($pid === 0) { try { f(0); } catch (Error $e) { echo "child ", $e->getMessage() === "${MSG}" ? "error" : $e->getMessage(), "\\n"; } exit(3); }
pcntl_waitpid($pid, $st); echo "parent ", pcntl_wexitstatus($st), "\\n";`);
  assert.equal(fork, 'child error\nparent 3\n');

  const lower = await php(ctx, '<?php function f($n) { return $n ? array_map("f", [$n - 1])[0] + 1 : 0; } try { echo f(100), "\\n"; } catch (Error $e) { echo $e->getMessage(), "\\n"; }', { flags: ['-d', 'zend.max_allowed_stack_size=256K'] });
  assert.equal(lower.stdout, 'Maximum call stack size of 212992 bytes (zend.max_allowed_stack_size - zend.reserved_stack_size) reached. Infinite recursion?\n', lower.stderr);
}
