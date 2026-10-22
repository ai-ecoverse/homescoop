/**
 * patches/0001 + 0002: no stack switching on WASIX, so Fiber exists (code
 * that only checks for the class works) but Fiber::start throws FiberError,
 * which a script can catch and carry on. Generators, which need no stack of
 * their own, work.
 */
import { php, phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  assert.equal(await phpOk(ctx, `<?php
echo class_exists("Fiber") ? "class" : "none", "|", (new ReflectionClass("FiberError"))->isFinal() ? "final" : "?", "\\n";
$f = new Fiber(function (string $x): string { return Fiber::suspend($x . "!"); });
try { $f->start("go"); echo "started\\n"; }
catch (FiberError $e) { echo get_class($e), ": ", $e->getMessage(), "\\n"; }
echo var_export($f->isStarted(), true), "|", var_export(Fiber::getCurrent(), true), "\\n";
function gen() { $x = yield 1; echo "got $x\\n"; yield from [2, 3]; return 4; }
$g = gen(); echo $g->current(), "\\n"; $g->send("sent"); while ($g->valid()) { echo $g->current(), "\\n"; $g->next(); } echo $g->getReturn(), "\\n";
echo "still running\\n";
`), "class|final\nFiberError: Fibers are not available on this platform (WASIX can't switch stacks)\nfalse|NULL\n1\ngot sent\n2\n3\n4\nstill running\n");
  // Uncaught, it is an ordinary fatal error (rc 255), not a trap.
  const r = await php(ctx, '<?php (new Fiber(fn() => 1))->start(); echo "unreached\\n";');
  assert.equal(r.status, 255, r.stderr);
  assert.match(r.stdout, /Fatal error: Uncaught FiberError: Fibers are not available on this platform/);
  assert.doesNotMatch(r.stdout + r.stderr, /unreached|RuntimeError|unreachable/);
}
