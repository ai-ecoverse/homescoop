export default async function ({ run, write, read, assert }) {
  const H = '/home/impswitch';
  const site = `${H}/site`;
  const CLAUDE = "# Mine\n\nKeep it short.\n\n<!-- impeccable start -->\nFor design or UI work, use the impeccable skill (/impeccable).\nUse DESIGN.md's tokens and components, not one-off colors, sizes or components.\n<!-- impeccable end -->\n";
  const CODEX = '# Codex rules\n\n<!-- impeccable:taste -->\nold wording\n<!-- /impeccable:taste -->\n';
  const COPILOT = '<!-- impeccable start -->\nbroken\n';
  const OVERRIDE = '<!-- impeccable start -->\nWrite interface copy in the voice PRODUCT.md describes.\n<!-- impeccable end -->\n';
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true}\n');
  await write(`${site.slice(1)}/.git/HEAD`, 'ref: refs/heads/main\n');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 2000)}\n--- stderr\n${r.stderr.slice(0, 1500)}`;
  const imp = (args, env = {}) => run(['impeccable', ...args], { cwd: site, env: { HOME: H, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1', ...env } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const ok = async (label, args, env) => {
    const r = await imp(args, env);
    clean(label, r);
    assert.equal(r.status, 0, show(label, r));
    assert.equal(r.stderr, '', show(label, r));
    return r.stdout;
  };

  assert.equal(await ok('switches (no agent)', ['switches']), "No agent's user-level rule file found.\n");

  await write(`${H.slice(1)}/.claude/CLAUDE.md`, CLAUDE);
  await write(`${H.slice(1)}/.codex/AGENTS.md`, CODEX);
  await write(`${H.slice(1)}/.gemini/settings.json`, '{}\n');
  await write(`${H.slice(1)}/.copilot/copilot-instructions.md`, COPILOT);
  await write(`${H.slice(1)}/.cursor/mcp.json`, '{}\n');
  await write(`${H.slice(1)}/codexhome/AGENTS.override.md`, OVERRIDE);
  const listed = [
    'Claude Code (~/.claude/CLAUDE.md): use, system',
    'Codex (~/.codex/AGENTS.md): taste',
    'Gemini CLI (~/.gemini/GEMINI.md): none',
    'GitHub Copilot (~/.copilot/copilot-instructions.md): unreadable, its Impeccable markers are duplicated or unbalanced',
  ];
  assert.equal(await ok('switches', ['switches']), `${listed.join('\n')}\n`);
  assert.equal(
    await ok('switches (CODEX_HOME)', ['switches'], { CODEX_HOME: `${H}/codexhome` }),
    `${[listed[0], 'Codex (~/codexhome/AGENTS.override.md): voice', listed[2], listed[3]].join('\n')}\n`,
  );
  assert.equal(await read(`${H}/.claude/CLAUDE.md`), CLAUDE);
  assert.equal(await read(`${H}/.codex/AGENTS.md`), CODEX);
  assert.equal(await read(`${H}/.copilot/copilot-instructions.md`), COPILOT);
  assert.equal(await read(`${H}/.gemini/GEMINI.md`), null);
  assert.equal(await read(`${site}/.cursor/rules/impeccable.mdc`), null);

  const catalog = JSON.parse(await ok('switches --catalog', ['switches', '--catalog']));
  assert.equal(catalog.schema, 1, JSON.stringify(catalog));
  assert.equal(catalog.start, '<!-- impeccable start -->', JSON.stringify(catalog));
  assert.equal(catalog.end, '<!-- impeccable end -->', JSON.stringify(catalog));
  assert.deepEqual(catalog.switches.map((s) => s.id), ['use', 'taste', 'wide', 'browser', 'system', 'critique', 'loop', 'voice', 'a11y'], JSON.stringify(catalog));
  assert.deepEqual(catalog.switches[0], { id: 'use', label: 'Use Impeccable for design work', line: 'For design or UI work, use the impeccable skill (/impeccable).' }, JSON.stringify(catalog));
  for (const s of catalog.switches) assert.ok(s.label && s.line && !s.line.includes('\n'), JSON.stringify(s));

  const usage = await imp(['switches', '--all']);
  clean('switches --all', usage);
  assert.equal(usage.status, 2, show('switches --all', usage));
  assert.equal(usage.stderr, 'Usage: impeccable switches [--catalog]\n', show('switches --all', usage));

  for (const [args, reason] of [
    [['shot', 'index.html'], 'needs browser capture'],
    [['shot', 'https://example.com/', '--full'], 'needs browser capture'],
    [['first-viewport', 'index.html', '--thesis', 'h1', '--action', 'a'], 'needs browser capture'],
    [['mcp'], 'needs Impeccable account sign-in'],
    [['switches-refresh'], 'needs Impeccable account sign-in'],
  ]) {
    const r = await imp(args);
    clean(args.join(' '), r);
    assert.equal(r.status, 1, show(args.join(' '), r));
    assert.equal(r.stdout, '', show(args.join(' '), r));
    assert.equal(r.stderr, `impeccable ${args[0]}: ${reason}; not available in this build yet\n`, show(args.join(' '), r));
  }
  const running = await imp(['agents', 'running', '--json']);
  clean('agents running --json', running);
  assert.equal(running.status, 1, show('agents running --json', running));
  assert.equal(running.stdout, '', show('agents running --json', running));
  assert.equal(running.stderr, 'impeccable agents running: needs the Impeccable MCP server; not available in this build yet\n', show('agents running --json', running));
  assert.equal(await read(`${site}/.impeccable/shots/1440x900.png`), null);
}
