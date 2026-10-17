#!/usr/bin/env node
// cert/notices.mjs on the host harness: runs the notices spec against the
// THIRD-PARTY-NOTICES.md inside a package tarball (homescoop#726).
//   node packages/wasix-sysroot/test/notices-host.mjs <package.tgz>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import spec from '../cert/notices.mjs';

const tgz = process.argv[2];
if (!tgz) {
  console.error('usage: notices-host.mjs <package.tgz>');
  process.exit(2);
}
const read = async (path) => {
  const file = path.replace(/^\/node_modules\/@ai-ecoverse\/wasix-sysroot\//, 'package/');
  try {
    return execFileSync('tar', ['-xOzf', tgz, file], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
await spec({ assert, npmName: '@ai-ecoverse/wasix-sysroot', read });
console.log('PASS cert/notices.mjs (host)');
