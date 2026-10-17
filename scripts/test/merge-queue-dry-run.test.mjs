// merge-queue dry run, do not keep: green alone, red next to the -b dry-run PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
test('merge-queue dry run: docs/merge-queue-dry-run-b.md does not exist', () => {
  assert.ok(!existsSync(new URL('../../docs/merge-queue-dry-run-b.md', import.meta.url)));
});
