export const CONTEXT = 'cert-review';
export const STATES = ['pending', 'success', 'failure'];
export const LIMIT = 140;

export function clip(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > LIMIT ? `${s.slice(0, LIMIT - 1)}…` : s;
}

const post = (state, description, go = false) => ({ state, description: clip(description), go });
const quiet = (why) => ({ state: null, description: clip(why), go: false });

export function planStatus(f) {
  if (!f.sha) return quiet(`no commit to post on${f.error ? `: ${f.error}` : ''}`);
  if (f.error) return post('failure', `cert-review plan failed: ${f.error}`);
  if (f.moved) return quiet(`moved on to ${f.head}; ladder-pr on the new head posts its own`);
  if (f.superseded) return quiet('a newer attempt of this ladder-pr run posts its own');
  if (!f.number) return post('failure', `no open pull request has head ${f.sha}`);
  if (!f.ladder) return post('failure', `no completed ladder-pr run on ${f.sha}`);
  const packages = f.packages ?? [];
  if (f.ladder !== 'success') return post('failure', `ladder-pr didn't pass (${f.ladder})`, f.ladder === 'failure' && !f.fork && packages.length > 0);
  if (f.fork && packages.length) return post('failure', "fork PRs aren't certified");
  if (!packages.length) return post('success', 'no package built');
  return post('pending', `reviewing ${packages.join(', ')}`, true);
}

export function groupStatus({ problems, members, error }) {
  if (error) return post('failure', `merge group check failed: ${error}`);
  if (problems?.length) return post('failure', `merge group refused: ${problems[0]}`);
  const list = (members ?? []).map((m) => `#${m.number}@${String(m.head).slice(0, 7)}`).join(', ');
  return post('success', `queued PRs certified: ${list}`);
}

export function ownedBy(targetUrl, runUrl) {
  const url = String(targetUrl ?? '');
  return Boolean(runUrl) && (url === runUrl || url.startsWith(`${runUrl}/`));
}

export async function failIfOurs({ github, owner, repo, sha, runUrl, description }) {
  if (!sha) return { posted: false, why: 'no head to post on' };
  const { data } = await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha, per_page: 100 });
  const now = data.statuses.find((s) => s.context === CONTEXT)?.target_url ?? '';
  if (!ownedBy(now, runUrl)) return { posted: false, why: `the ${CONTEXT} status on ${sha} is from another run (${now || 'none'}); it posts its own` };
  await github.rest.repos.createCommitStatus({ owner, repo, sha, state: 'failure', context: CONTEXT, description: clip(description), target_url: runUrl });
  return { posted: true, why: `${CONTEXT}=failure on ${sha}: ${clip(description)}` };
}
