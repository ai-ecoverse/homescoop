#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const path = process.argv[2];
if (!path) {
  console.error('usage: tarball-epoch.mjs <tarball>');
  process.exit(2);
}

const raw = readFileSync(resolve(path));
const data = /\.(tgz|tar\.gz)$/i.test(path) ? gunzipSync(raw) : raw;
let offset = 0;
let max = 0;
while (offset + 512 <= data.length) {
  const block = data.subarray(offset, offset + 512);
  offset += 512;
  if (block.every((b) => b === 0)) {
    if (offset + 512 <= data.length && data.subarray(offset, offset + 512).every((b) => b === 0)) break;
    continue;
  }
  const size = parseInt(block.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim(), 8) || 0;
  const mtime = parseInt(block.subarray(136, 148).toString('utf8').replace(/\0/g, '').trim(), 8) || 0;
  const typeflag = String.fromCharCode(block[156] || 0);
  if ((typeflag === '0' || typeflag === '\0') && mtime > max) max = mtime;
  offset += size + ((512 - (size % 512)) % 512);
}
if (!/^[1-9][0-9]*$/.test(String(max))) {
  console.error(`tarball-epoch: no regular-file mtime in ${path}`);
  process.exit(1);
}
process.stdout.write(String(max));
