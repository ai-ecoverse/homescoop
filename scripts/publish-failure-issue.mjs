#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubApi } from './ladder-merge-resolve.mjs';

export const LABEL = 'publish-failure';

export async function reportFailure({ title, body }, gh) {
  const same = (await gh.openIssues(LABEL)).find((i) => i.title === title && !i.pull_request);
  if (same) {
    await gh.comment(same.number, body);
    return { action: 'commented on', number: same.number };
  }
  await gh.ensureLabel(LABEL);
  const created = await gh.createIssue({ title, body, labels: [LABEL] });
  return { action: 'opened', number: created.number };
}

export function githubIssues({ repo, token }) {
  const api = githubApi({ repo, token });
  return {
    async openIssues(label) {
      return (await api(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`)).json();
    },
    async comment(number, body) {
      await api(`/issues/${number}/comments`, { method: 'POST', body: { body } });
    },
    async ensureLabel(name) {
      try {
        await api(`/labels/${encodeURIComponent(name)}`);
      } catch (err) {
        if (err.status !== 404) throw err;
        const description = 'ladder-build or ladder-automerge could not publish or merge';
        await api('/labels', { method: 'POST', body: { name, color: 'b60205', description } });
      }
    },
    async createIssue(issue) {
      return (await api('/issues', { method: 'POST', body: issue })).json();
    },
  };
}

export async function reportFromEnv({ title, body }) {
  const gh = githubIssues({
    repo: process.env.GITHUB_REPOSITORY || 'ai-ecoverse/homescoop',
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });
  const { action, number } = await reportFailure({ title, body }, gh);
  console.log(`${action} issue #${number}: ${title}`);
}

async function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const title = at('--title');
  const file = at('--body-file');
  if (!title || !file) throw new Error('usage: publish-failure-issue.mjs --title <title> --body-file <file>');
  await reportFromEnv({ title, body: readFileSync(file, 'utf8') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
