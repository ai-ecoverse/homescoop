#!/usr/bin/env jsh
// freetype build.jsh — delegates to build.sh (shared body for host + slicc).
const { spawn } = require('child_process');
const ROOT = process.env.HOMESCOOP_ROOT || '/mnt/homescoop';
const script = `${ROOT}/packages/freetype/build.sh`;
const child = spawn('bash', [script], {
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (e) => { console.error(String(e)); process.exit(1); });
child.on('close', (code) => process.exit(code || 0));
