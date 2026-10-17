#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verdictLine(gate, pass, summary = '') {
  return `${gate}: ${pass ? 'PASS' : 'FAIL'}${summary ? ` ${summary}` : ''}`;
}

export function say(gate, pass, summary = '', { stderr = false } = {}) {
  (stderr ? console.error : console.log)(verdictLine(gate, pass, summary));
}

export function finish(gate, code, summary = '', options = {}) {
  say(gate, code === 0, summary, options);
  return code;
}

const escape = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

export function findVerdict(gate, text) {
  const re = new RegExp(`^${escape(gate)}: (PASS|FAIL)(?: (.*))?$`, 'gm');
  let last = null;
  for (const m of String(text).matchAll(re)) last = { verdict: m[1], summary: m[2] || '' };
  return last;
}

export function judge(gate, status, text) {
  const v = findVerdict(gate, text);
  const rc = status === 0 ? 1 : status || 1;
  if (!v) return { code: rc, message: `${gate}: no "${gate}: PASS|FAIL" verdict line (exit ${status}); a gate that says nothing has not passed` };
  if (v.verdict === 'PASS' && status === 0) return { code: 0, message: '' };
  if (v.verdict === 'PASS') return { code: rc, message: `${gate}: said PASS but exited ${status}` };
  if (status === 0) return { code: 1, message: `${gate}: said FAIL but exited 0` };
  return { code: status, message: '' };
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
  let text = '';
  const keep = (chunk) => {
    text += chunk;
    if (text.length > 1 << 20) text = text.slice(-(1 << 19));
  };
  child.stdout.on('data', (c) => {
    process.stdout.write(c);
    keep(c.toString());
  });
  child.stderr.on('data', (c) => {
    process.stderr.write(c);
    keep(c.toString());
  });
  child.on('error', (err) => {
    console.log(`::error::${gate}: cannot run ${cmd}: ${err.message}`);
    process.exit(127);
  });
  child.on('close', (status, signal) => {
    const { code, message } = judge(gate, signal ? 128 : status, text);
    if (message) console.log(`::error::${message}`);
    process.exit(code);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
