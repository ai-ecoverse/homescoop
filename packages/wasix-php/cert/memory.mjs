/**
 * patches/0004: the Zend memory manager's 2 MiB chunks and huge blocks come
 * from posix_memalign/free. Huge strings and arrays grow (realloc can't
 * extend in place, so it copies), shrink and are freed back: after unset()
 * memory_get_usage() returns to where it was, real usage drops, and
 * repeating the cycle doesn't grow the process.
 */
import { phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  // A huge block (> 2 MiB) can't grow in place here, so .= copies it and
  // briefly needs old + new against memory_limit: raise it.
  const out = await phpOk(ctx, `<?php
ini_set("memory_limit", "512M");
$base = memory_get_usage();
$s = ""; for ($i = 0; $i < 64; $i++) { $s .= str_repeat(chr(65 + $i % 26), 1 << 20); }
echo strlen($s), "|", substr($s, (1 << 20) * 25, 1), substr($s, -1), "|", md5($s), "\\n";
$peak1 = memory_get_usage(true);
unset($s);
echo memory_get_usage() - $base < 65536 ? "freed" : "leak " . (memory_get_usage() - $base), "|", memory_get_usage(true) < $peak1 ? "chunks returned" : "kept", "\\n";
for ($round = 0; $round < 5; $round++) {
  $a = range(1, 1000000); $b = array_flip($a); $t = str_repeat("y", 40 << 20); $t[0] = "z";
  $sum = array_sum($a) + count($b) + strlen($t);
  unset($a, $b, $t);
  $peaks[] = memory_get_peak_usage(true) >> 20;
}
echo $sum, "|", count(array_unique($peaks)) === 1 ? "steady" : implode(",", $peaks), "\\n";
$x = str_repeat("a", 3 << 20); $x = substr($x, 0, 5 << 10); echo strlen($x), "\\n";
$big = new SplFixedArray(2000000); for ($i = 0; $i < 2000000; $i += 1000) $big[$i] = $i; echo $big[1999000], "\\n";
echo memory_get_usage() - $base < (40 << 20) ? "bounded" : "grew " . (memory_get_usage() - $base), "\\n";
`);
  const l = out.split('\n');
  assert.match(l[0], /^67108864\|ZL\|[0-9a-f]{32}$/);
  assert.equal(l[1], 'freed|chunks returned', out);
  assert.equal(l[2], `${500000500000 + 1000000 + (40 << 20)}|steady`, out);
  assert.equal(l[3], '5120');
  assert.equal(l[4], '1999000');
  assert.equal(l[5], 'bounded');
  // USE_ZEND_ALLOC=0 (libc malloc for everything) works too.
  const r = await ctx.run(['php', '-r', 'echo strlen(str_repeat("q", 8 << 20)), "\\n";'], { cwd: '/tmp', env: { USE_ZEND_ALLOC: '0' } });
  assert.equal(r.stdout, '8388608\n', r.stderr);
}
