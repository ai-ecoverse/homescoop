import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenceFileErrors } from '../browser-cert/licence-files.mjs';

test('licenceFileErrors: each file present with each phrase, whitespace-insensitive (#897)', () => {
  const want = { LICENSE: ['Copyright 2009 The Go Authors.'], PATENTS: ['Additional IP Rights Grant (Patents)'] };
  assert.deepEqual(licenceFileErrors({ LICENSE: 'Copyright 2009\n  The Go Authors.', PATENTS: 'Additional IP Rights Grant (Patents)\n' }, want), []);
  assert.deepEqual(licenceFileErrors({ LICENSE: 'Copyright 2009 The Go Authors.', PATENTS: null }, want), ['PATENTS is not in the package']);
  assert.deepEqual(licenceFileErrors({ LICENSE: 'BSD', PATENTS: 'Additional IP Rights Grant (Patents)' }, want), ['LICENSE lacks "Copyright 2009 The Go Authors."']);
});
