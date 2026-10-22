/**
 * patches/0006: php://fd/N (no getdtablesize() on WASI): php://fd/1 and
 * /2 are stdout and stderr, a descriptor the caller opened is reachable,
 * and a negative or closed one fails with PHP's own messages. (A WASI
 * program's fds from 3 up are the kernel's preopened directories, so a
 * descriptor a shell opens for php can't be checked here.)
 */
import { php } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  const r = await php(ctx, `<?php
file_put_contents("php://fd/1", "to fd1\\n");
file_put_contents("php://fd/2", "to fd2\\n");
$o = fopen("php://fd/1", "w"); fwrite($o, "fopen fd1\\n"); fclose($o);
echo var_export(@fopen("php://fd/-1", "r"), true), "|", error_get_last()["message"] ?? "", "\\n";
echo var_export(@fopen("php://fd/77", "r"), true), "\\n";
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, 'to fd2\n');
  assert.equal(r.stdout, 'to fd1\nfopen fd1\nfalse|fopen(php://fd/-1): Failed to open stream: The file descriptors must be non-negative numbers smaller than 2147483647\nfalse\n');
}
