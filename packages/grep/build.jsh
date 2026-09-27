#!/usr/bin/env jsh
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync('bash', [join(here, 'build.sh')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
