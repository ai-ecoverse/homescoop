#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NO_VERDICT = 3;

export function verdictIn(gate, text) {
  const esc = gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:::[a-z]+::)?${esc}: (PASS|FAIL)\\b`, 'm');
  return re.exec(text)?.[1] ?? null;
}

export function decide(gate, status, seen) {
  if (status !== 0) return { code: status || 1, note: seen ? null : `::error::${gate}: exited ${status} with no "${gate}: FAIL" line` };
  if (seen === 'PASS') return { code: 0, note: null };
  if (seen === 'FAIL') return { code: 1, note: `::error::${gate}: printed FAIL but exited 0` };
  return { code: NO_VERDICT, note: `::error::${gate}: exited 0 without a "${gate}: PASS" line; a gate's silence is not a pass (homescoop#968)` };
}

function main(argv) {
  const sep = argv.indexOf('--');
  const gate = argv[0];
  if (!gate || sep !== 1 || argv.length < 3) {
    console.error('usage: gate.mjs <gate> -- <command> [args…]');
    process.exit(2);
  }
  const [cmd, ...args] = argv.slice(2);
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  let seen = null;
  const tail = { out: '', err: '' };
  const watch = (stream, key, sink) =>
    stream.on('data', (d) => {
      sink.write(d);
      const text = tail[key] + d.toString('utf8');
      const lines = text.split('\n');
      tail[key] = lines.pop();
      const v = verdictIn(gate, lines.join('\n'));
      if (v && seen !== 'FAIL') seen = v;
    });
  watch(child.stdout, 'out', process.stdout);
  watch(child.stderr, 'err', process.stderr);
  child.on('error', (err) => {
    console.error(`::error::${gate}: could not run ${cmd}: ${err.message}`);
    process.exit(1);
  });
  child.on('close', (status, signal) => {
    for (const rest of [tail.out, tail.err]) {
      const v = verdictIn(gate, rest);
      if (v && seen !== 'FAIL') seen = v;
    }
    const { code, note } = decide(gate, signal ? 1 : status, seen);
    if (note) console.error(note);
    process.exit(code);
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
