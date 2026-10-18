#!/usr/bin/env node
// The `gh` on cert-review's agent PATH. It runs the real gh ($CERT_REVIEW_REAL_GH) for everything
// except creating an issue: `gh issue create`, `gh api` POSTs to repos/<o>/<r>/issues, and a GraphQL
// createIssue. Those go through scripts/cert-review/file-issue.mjs, which dedupes by a key and
// talks to the REST API itself (it never calls gh), so nothing that comes through here may create one.
// This is a guard rail, not the gate: issue-dedupe.mjs, after the review, fails the job on any
// `[cert]` issue the run opened without a cert-review-key marker, however it was opened.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith('-')) out.push(a);
  }
  return out;
}

export function refusal(args) {
  const pos = positionals(args);
  if (pos[0] === 'issue' && (pos[1] === 'create' || pos[1] === 'new')) return `\`gh issue ${pos[1]}\``;
  if (pos[0] !== 'api') return null;
  const rest = args.slice(args.indexOf('api') + 1);
  if (rest.some((a) => /\bcreateIssue\b/.test(a))) return 'a GraphQL createIssue';
  const graphql = positionals(rest)[0] === 'graphql';
  if (graphql) {
    // A request body or field read from a file or stdin: look inside it.
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      let file = null;
      if (a === '--input') file = rest[i + 1];
      else if (a.startsWith('--input=')) file = a.slice(8);
      else {
        const v = /^(-f|-F|--field|--raw-field)$/.test(a) ? rest[i + 1] : a.match(/^(?:-[fF]|--(?:raw-)?field=)(.+)$/)?.[1];
        file = v?.match(/^[^=]+=@(.+)$/)?.[1] ?? null;
      }
      if (file === null || file === undefined) continue;
      if (file === '-') return 'a GraphQL request read from stdin (it may create an issue)';
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        return `a GraphQL request from ${file}, which can't be read`;
      }
      if (/\bcreateIssue\b/.test(text)) return `a GraphQL createIssue (in ${file})`;
    }
  }
  let endpoint = null;
  let method = null;
  let fields = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const eq = a.match(/^(--method|-X)=?(.*)$/);
    if (eq) {
      method = (eq[2] || rest[++i] || '').toUpperCase();
      continue;
    }
    if (/^(-f|-F|--field|--raw-field|--input)$/.test(a)) {
      fields = true;
      i++;
      continue;
    }
    if (/^(-f|-F)./.test(a) || /^--(field|raw-field|input)=/.test(a)) {
      fields = true;
      continue;
    }
    if (/^(-H|--header|-q|--jq|-t|--template|--hostname|--cache)$/.test(a)) {
      i++;
      continue;
    }
    if (!a.startsWith('-') && endpoint === null) endpoint = a;
  }
  const post = (method ?? (fields ? 'POST' : 'GET')) === 'POST';
  const path = String(endpoint ?? '').replace(/^https:\/\/api\.github\.com/, '').replace(/^\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  if (post && /^repos\/[^/]+\/[^/]+\/issues$/.test(path)) return `\`gh api\` POST to ${path}`;
  return null;
}

export const MESSAGE = (what) =>
  `gh (cert-review): ${what} is refused here. File and cite issues only through ` +
  '`node "$CERT_REVIEW_TOOLS/scripts/cert-review/file-issue.mjs" --package … --case <spec>:<case> --title "[cert] …" --body-file …`, ' +
  'which comments on an open issue for the same failure instead of filing it again. ' +
  'After the review, issue-dedupe fails this job on any [cert] issue opened without its marker.';

function main(args) {
  const what = refusal(args);
  if (what) {
    console.error(MESSAGE(what));
    process.exit(4);
  }
  const real = process.env.CERT_REVIEW_REAL_GH;
  if (!real) {
    console.error('gh (cert-review): CERT_REVIEW_REAL_GH is not set, so there is no gh to run');
    process.exit(127);
  }
  const r = spawnSync(real, args, { stdio: 'inherit' });
  if (r.error) {
    console.error(`gh (cert-review): ${r.error.message}`);
    process.exit(127);
  }
  process.exit(r.status ?? 1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
