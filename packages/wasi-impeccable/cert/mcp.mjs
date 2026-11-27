export default async function ({ run, write, read, assert }) {
  const H = '/home/impmcp';
  const PROD = 'https://api.impeccable.style/mcp';
  const STAGING = 'https://api.staging.impeccable.style/mcp';
  const CLAUDE_SIGN_IN = 'in Claude Code, run /mcp, choose impeccable, then Authenticate.';
  const CODEX_SIGN_IN = 'run codex mcp login impeccable (skip it if Codex just signed you in).';
  const LATER = [
    { agent: 'cursor', label: 'Cursor', result: 'not_found' },
    { agent: 'copilot', label: 'GitHub Copilot CLI', result: 'not_found' },
    { agent: 'opencode', label: 'opencode', result: 'not_found' },
  ];
  const REFUSED = "IMPECCABLE_ACCOUNT_URL isn't the Impeccable account or its staging service, so no MCP server was added. Unset it to connect to Impeccable.";
  await write(`${H.slice(1)}/.keep`, '');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 1200)}\n--- stderr\n${r.stderr.slice(0, 1200)}`;
  const base = (home) => ({ HOME: home, PATH: `${home}/bin:/usr/bin:/bin` });
  const imp = (args, env = {}, home = H) => run(['impeccable', ...args], { cwd: home, env: { ...base(home), ...env } });
  const clean = (label, r) => assert.ok(!/Unknown command|Usage:|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const ls = async (dir) => {
    const r = await run(['ls', '-A', dir], { cwd: H });
    assert.equal(r.status, 0, show(`ls ${dir}`, r));
    return r.stdout.split('\n').filter(Boolean);
  };

  const none = await imp(['loop', 'connect', '--mcp-only']);
  assert.equal(none.status, 1, show('loop connect --mcp-only (no agent)', none));
  clean('loop connect --mcp-only (no agent)', none);
  assert.equal(none.stdout, '', show('loop connect --mcp-only (no agent)', none));
  assert.equal(
    none.stderr,
    'Claude Code: not found, skipped.\nCodex: not found, skipped.\nCursor: not found, skipped.\nGitHub Copilot CLI: not found, skipped.\nopencode: not found, skipped.\nNo coding agent found to connect (Claude Code, Codex, Cursor, GitHub Copilot CLI, opencode).\n',
    show('loop connect --mcp-only (no agent)', none),
  );
  assert.deepEqual((await ls(H)).sort(), ['.impeccable', '.keep']);
  assert.deepEqual(await ls(`${H}/.impeccable`), ['.mcp-connect.lock']);

  const noneJson = await imp(['loop', 'connect', '--mcp-only', '--json']);
  assert.equal(noneJson.status, 1, show('loop connect --mcp-only --json (no agent)', noneJson));
  clean('loop connect --mcp-only --json (no agent)', noneJson);
  assert.deepEqual(JSON.parse(noneJson.stdout), {
    ok: false,
    agents: [
      { agent: 'claude', label: 'Claude Code', result: 'not_found' },
      { agent: 'codex', label: 'Codex', result: 'not_found' },
      ...LATER,
    ],
  }, show('loop connect --mcp-only --json (no agent)', noneJson));

  const claudeJson = `${JSON.stringify({ numStartups: 3, mcpServers: { impeccable: { type: 'http', url: PROD } } }, null, 2)}\n`;
  await write(`${H.slice(1)}/bin/claude`, '#!/bin/sh\n');
  await write(`${H.slice(1)}/.claude.json`, claudeJson);
  await write(`${H.slice(1)}/tools/codex`, '#!/bin/sh\n');
  await write(`${H.slice(1)}/.codex/config.toml`, `model = "gpt-5"\n\n[mcp_servers.impeccable]\nurl = "${PROD}"\ndefault_tools_approval_mode = "approve"\n`);
  const codexBin = { IMPECCABLE_CODEX_BIN: `${H}/tools/codex` };

  const claude = await imp(['loop', 'connect', '--mcp-only', '--agent', 'claude']);
  assert.equal(claude.status, 0, show('loop connect --mcp-only --agent claude', claude));
  clean('loop connect --mcp-only --agent claude', claude);
  assert.equal(claude.stdout, `Claude Code: MCP server already there.\n  Sign in: ${CLAUDE_SIGN_IN}\n`, show('loop connect --mcp-only --agent claude', claude));

  const both = await imp(['loop', 'connect', '--mcp-only', '--json'], codexBin);
  assert.equal(both.status, 0, show('loop connect --mcp-only --json', both));
  clean('loop connect --mcp-only --json', both);
  assert.deepEqual(JSON.parse(both.stdout), {
    ok: true,
    agents: [
      { agent: 'claude', label: 'Claude Code', result: 'connected', added: false, signIn: CLAUDE_SIGN_IN, manualMcp: null },
      { agent: 'codex', label: 'Codex', result: 'connected', added: false, signIn: CODEX_SIGN_IN, manualMcp: null },
      ...LATER,
    ],
  }, show('loop connect --mcp-only --json', both));

  const staging = { IMPECCABLE_ACCOUNT_URL: 'https://api.staging.impeccable.style/' };
  const differ = await imp(['loop', 'connect', '--mcp-only', '--agent', 'claude'], staging);
  assert.equal(differ.status, 1, show('loop connect --mcp-only --agent claude (staging account)', differ));
  clean('loop connect --mcp-only --agent claude (staging account)', differ);
  assert.equal(
    differ.stderr,
    `Claude Code: not connected: ${H}/.claude.json already has a different MCP server called impeccable; it was left alone. Remove or rename it, then connect again.\n`,
    show('loop connect --mcp-only --agent claude (staging account)', differ),
  );
  assert.equal(await read(`${H}/.claude.json`), claudeJson);

  await write(`${H.slice(1)}/codex-staging/config.toml`, `[mcp_servers.impeccable]\nurl = "${STAGING}"\n`);
  const stagingCodex = await imp(
    ['loop', 'connect', '--mcp-only', '--agent', 'codex'],
    { ...staging, ...codexBin, CODEX_HOME: `${H}/codex-staging`, IMPECCABLE_HOME: `${H}/imphome` },
  );
  assert.equal(stagingCodex.status, 0, show('loop connect --mcp-only --agent codex (staging account)', stagingCodex));
  clean('loop connect --mcp-only --agent codex (staging account)', stagingCodex);
  assert.equal(stagingCodex.stdout, `Codex: MCP server already there.\n  Sign in: ${CODEX_SIGN_IN}\n`, show('loop connect --mcp-only --agent codex (staging account)', stagingCodex));
  assert.deepEqual(await ls(`${H}/imphome`), ['.mcp-connect.lock']);

  for (const url of ['https://example.com', 'http://api.impeccable.style']) {
    const label = `loop connect --mcp-only (IMPECCABLE_ACCOUNT_URL=${url})`;
    const r = await imp(['loop', 'connect', '--mcp-only'], { ...codexBin, IMPECCABLE_ACCOUNT_URL: url });
    assert.equal(r.status, 1, show(label, r));
    clean(label, r);
    assert.equal(r.stderr, `${REFUSED}\n`, show(label, r));
    const j = await imp(['loop', 'connect', '--mcp-only', '--json'], { ...codexBin, IMPECCABLE_ACCOUNT_URL: url });
    assert.equal(j.status, 1, show(`${label} --json`, j));
    assert.deepEqual(JSON.parse(j.stdout), { ok: false, error: REFUSED, agents: [] }, show(`${label} --json`, j));
  }
  assert.equal(await read(`${H}/.claude.json`), claudeJson);

  const unknown = await imp(['loop', 'connect', '--mcp-only', '--agent', 'gemini']);
  assert.equal(unknown.status, 1, show('loop connect --mcp-only --agent gemini', unknown));
  clean('loop connect --mcp-only --agent gemini', unknown);
  assert.equal(unknown.stderr, 'Unknown agent: gemini. Use claude, codex, cursor, copilot, opencode.\n', show('loop connect --mcp-only --agent gemini', unknown));

  const taste = await imp(['loop', 'connect', '--mcp-only', '--taste']);
  assert.equal(taste.status, 1, show('loop connect --mcp-only --taste', taste));
  assert.match(taste.stderr, /^--mcp-only goes with loop connect \[--agent claude\|codex\|cursor\|copilot\|opencode\] \[--json\], and nothing else\.$/m, show('loop connect --mcp-only --taste', taste));

  const H2 = '/home/impmcp2';
  await write(`${H2.slice(1)}/bin/claude`, '#!/bin/sh\n');
  const absent = await imp(['loop', 'connect', '--mcp-only', '--agent', 'claude'], {}, H2);
  assert.equal(absent.status, 1, show('loop connect --mcp-only --agent claude (no entry yet)', absent));
  clean('loop connect --mcp-only --agent claude (no entry yet)', absent);
  assert.match(absent.stderr, /^Claude Code: not connected: \S.*$/m, show('loop connect --mcp-only --agent claude (no entry yet)', absent));
  assert.deepEqual((await ls(H2)).sort(), ['.impeccable', 'bin']);

  const usage = await imp(['loop']);
  assert.equal(usage.status, 1, show('loop', usage));
  assert.match(usage.stderr, /^ +impeccable loop connect --mcp-only \[--agent claude\|codex\|cursor\|copilot\|opencode\] \[--json\]$/m, show('loop', usage));

  const status = await imp(['status']);
  assert.equal(status.status, 1, show('status', status));
  clean('status', status);
  assert.match(status.stderr, /^impeccable status: needs Impeccable account sign-in; not available in this build yet$/m, show('status', status));
  assert.equal(status.stdout, '', show('status', status));
}
