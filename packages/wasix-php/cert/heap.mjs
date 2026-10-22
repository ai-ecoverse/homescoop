/**
 * The initial heap (homescoop#1287, slicc-kernel#1172): php.wasm is a
 * threaded bulk-memory module, linked with recipe.yaml's wasm.initial-memory.
 * Typical workloads stay inside it, so php never grows the shared memory;
 * a bigger one grows past it through the allocator refresh (wasix-sysroot
 * -39), with no wasm trap. VmSize of each php process is polled from
 * /proc/<pid>/status (php is single-threaded: that is the allocating
 * thread's view), 3 rounds, under SLICC_WASM_BACKTRACE=1.
 */
const WORK = {
  hello: '<?php echo "hello\\n";',
  json: '<?php $a = []; for ($i = 0; $i < 40000; $i++) $a[] = ["id" => $i, "name" => "item $i", "tags" => ["a", "b", "c"], "price" => $i * 1.5]; $j = json_encode($a); $b = json_decode($j, true); echo strlen($j) > 2500000 && count($b) === 40000 ? "ok" : "bad", "\\n";',
  arrays: '<?php $a = range(1, 1000000); shuffle($a); sort($a); $h = array_flip($a); echo $a[999999] === 1000000 && count($h) === 1000000 ? "ok" : "bad", "\\n";',
  strings: '<?php $s = ""; for ($i = 0; $i < 200000; $i++) $s .= "line $i of some generated text\\n"; $w = str_word_count($s); $r = preg_replace("/(\\d+)/", "[$1]", $s); echo strlen($r) > strlen($s) && $w > 0 ? "ok" : "bad", "\\n";',
  sqlite: '<?php $db = new PDO("sqlite::memory:"); $db->exec("CREATE TABLE t (a, b)"); $db->beginTransaction(); $st = $db->prepare("INSERT INTO t VALUES (?, ?)"); for ($i = 0; $i < 100000; $i++) $st->execute([$i, "v$i"]); $db->commit(); echo $db->query("SELECT count(*) FROM t")->fetchColumn() == 100000 ? "ok" : "bad", "\\n";',
  xml: '<?php $x = "<r>"; for ($i = 0; $i < 40000; $i++) $x .= "<item id=\\"$i\\"><name>n$i</name></item>"; $x .= "</r>"; $d = new DOMDocument; $d->loadXML($x); echo (new DOMXPath($d))->evaluate("count(//item)") == 40000 ? "ok" : "bad", "\\n";',
  fork: '<?php $big = str_repeat("x", 8 << 20); $pid = pcntl_fork(); if ($pid === 0) { $s = str_replace("x", "yy", $big); exit(strlen($s) === 16 << 20 ? 0 : 1); } pcntl_waitpid($pid, $st); echo pcntl_wexitstatus($st) === 0 ? "ok" : "bad", "\\n";',
  big: '<?php $a = []; for ($i = 0; $i < 400000; $i++) $a["key$i"] = [$i, "v$i"]; echo count($a) === 400000 ? "ok" : "bad", "\\n";',
};
const INITIAL_KB = 128 * 1024;
const GROWS = new Set(['big']);

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (const [name, text] of Object.entries(WORK)) await write(`/tmp/php-heap/${name}.php`, text);
  const script = (name) =>
    [
      `php /tmp/php-heap/${name}.php >/tmp/php-heap/${name}.out 2>/tmp/php-heap/${name}.err & pid=$!; m=0`,
      'while kill -0 $pid 2>/dev/null; do',
      '  if [ -r /proc/$pid/status ]; then n=; v=0; while read -r k x u; do [ "$k" = Name: ] && n=$x; [ "$k" = VmSize: ] && v=$x; done < /proc/$pid/status 2>/dev/null; [ "$n" = php ] && [ "$v" -gt "$m" ] && m=$v; fi',
      'done; wait $pid; rc=$?',
      `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*RuntimeError*) t=$((t+1));; esac; done < /tmp/php-heap/${name}.err`,
      'echo "rc=$rc peak_kb=$m traps=$t"',
    ].join('\n');
  let traps = 0;
  const peaks = {};
  for (let round = 1; round <= 3; round++) {
    for (const name of Object.keys(WORK)) {
      const r = await run(['bash', '-c', script(name)], { cwd: '/tmp', env: { SLICC_WASM_BACKTRACE: '1' } });
      const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
      traps += Number(m[3] ?? 1);
      peaks[name] = Math.max(peaks[name] ?? 0, Number(m[2] ?? 0));
      const out = await run(['cat', `/tmp/php-heap/${name}.out`, `/tmp/php-heap/${name}.err`]);
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${out.stdout}`);
      assert.equal(out.stdout.trim(), name === 'hello' ? 'hello' : 'ok', `round ${round} ${name}`);
    }
  }
  console.log(`heap: 3 rounds of ${Object.keys(WORK).join(', ')}: ${traps} traps, VmSize peak kB ${JSON.stringify(peaks)}`);
  assert.equal(traps, 0, 'no wasm trap in 3 rounds');
  for (const [name, kb] of Object.entries(peaks)) {
    assert.ok(kb > 0, `${name}: no VmSize read from /proc/<pid>/status`);
    if (GROWS.has(name)) assert.ok(kb > INITIAL_KB, `${name}: a 400000-entry array of arrays grows past the initial heap through memory.grow and the allocator refresh: VmSize peak ${kb} kB`);
    else assert.equal(kb, INITIAL_KB, `${name}: the wasm memory stays at the initial heap, so php never calls memory.grow (recipe.yaml wasm; homescoop#1287): VmSize peak ${kb} kB`);
  }
}
