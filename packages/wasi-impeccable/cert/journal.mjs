export default async function ({ run, write, read, assert }) {
  const H = '/home/impjournal';
  const PROD = 'https://api.impeccable.style/mcp';
  const STAGING = 'https://api.staging.impeccable.style/mcp';
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 1200)}\n--- stderr\n${r.stderr.slice(0, 1200)}`;
  const imp = (args, env = {}) => run(['impeccable', ...args], { cwd: H, env: { HOME: H, PATH: `${H}/bin:/usr/bin:/bin`, ...env } });
  const clean = (label, r) => assert.ok(!/Unknown (command|agent)|Usage:|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const ls = async (dir) => {
    const r = await run(['ls', '-A', dir], { cwd: H });
    assert.equal(r.status, 0, show(`ls ${dir}`, r));
    return r.stdout.split('\n').filter(Boolean);
  };
  for (const bin of ['copilot', 'opencode', 'cursor-agent']) await write(`${H.slice(1)}/bin/${bin}`, '#!/bin/sh\n');

  const mine = '{"mcpServers":{"github":{"type":"http","url":"https://example.com/mcp"}},"theme":"dark"}\n';
  await write(`${H.slice(1)}/.copilot/mcp-config.json`, mine);
  const added = await imp(['loop', 'connect', '--mcp-only', '--agent', 'copilot']);
  assert.equal(added.status, 0, show('loop connect --mcp-only --agent copilot', added));
  clean('loop connect --mcp-only --agent copilot', added);
  assert.equal(added.stdout, 'GitHub Copilot CLI: MCP server added.\n  Sign in: on first use.\n', show('loop connect --mcp-only --agent copilot', added));
  const written = await read(`${H}/.copilot/mcp-config.json`);
  assert.deepEqual(JSON.parse(written), {
    mcpServers: {
      github: { type: 'http', url: 'https://example.com/mcp' },
      impeccable: { type: 'http', url: PROD, tools: ['*'] },
    },
    theme: 'dark',
  }, written);
  const journals = await ls(`${H}/.impeccable/agents`);
  assert.equal(journals.length, 1, journals.join(' '));
  assert.match(journals[0], /^impeccable-loop-copilot-[0-9a-f]+\.json$/, journals.join(' '));

  const again = await imp(['loop', 'connect', '--mcp-only', '--agent', 'copilot', '--json']);
  assert.equal(again.status, 0, show('loop connect --mcp-only --agent copilot --json (again)', again));
  clean('loop connect --mcp-only --agent copilot --json (again)', again);
  assert.deepEqual(JSON.parse(again.stdout), {
    ok: true,
    agents: [{ agent: 'copilot', label: 'GitHub Copilot CLI', result: 'connected', added: false, signIn: 'on first use.', manualMcp: null }],
  }, show('loop connect --mcp-only --agent copilot --json (again)', again));
  assert.equal(await read(`${H}/.copilot/mcp-config.json`), written);

  const listed = await imp(['agents', 'list']);
  assert.equal(listed.status, 0, show('agents list', listed));
  const installs = JSON.parse(listed.stdout).result.installations;
  assert.equal(installs.length, 1, show('agents list', listed));
  assert.equal(installs[0].owner, 'impeccable-loop', show('agents list', listed));
  assert.equal(installs[0].harness, 'copilot', show('agents list', listed));
  assert.deepEqual(installs[0].hooks, [], show('agents list', listed));
  assert.deepEqual(installs[0].mcpServers, ['impeccable'], show('agents list', listed));
  assert.deepEqual(installs[0].resources.map((x) => x.kind), ['json-entries'], show('agents list', listed));

  await write(`${H.slice(1)}/copilot-spec.json`, JSON.stringify({ version: 1, owner: 'impeccable-loop', harness: 'copilot', root: `${H}/.copilot` }));
  const undo = await imp(['agents', 'undo', '--spec', 'copilot-spec.json']);
  assert.equal(undo.status, 0, show('agents undo', undo));
  assert.equal(JSON.parse(undo.stdout).ok, true, show('agents undo', undo));
  assert.equal(await read(`${H}/.copilot/mcp-config.json`), mine);
  const gone = await imp(['agents', 'list']);
  assert.equal(JSON.parse(gone.stdout).result.installations.length, 0, show('agents list after undo', gone));

  await write(`${H.slice(1)}/copstaging/mcp-config.json`, `{"mcpServers":{"impeccable":{"type":"http","url":"${STAGING}","tools":["*"]}}}\n`);
  const differ = await imp(['loop', 'connect', '--mcp-only', '--agent', 'copilot'], { COPILOT_HOME: `${H}/copstaging` });
  assert.equal(differ.status, 1, show('loop connect --mcp-only --agent copilot (a different entry)', differ));
  clean('loop connect --mcp-only --agent copilot (a different entry)', differ);
  assert.equal(
    differ.stderr,
    `GitHub Copilot CLI: not connected: ${H}/copstaging/mcp-config.json already has a different MCP server called impeccable; it was left alone. Remove or rename it, then connect again.\n`,
    show('loop connect --mcp-only --agent copilot (a different entry)', differ),
  );
  assert.equal(await read(`${H}/copstaging/mcp-config.json`), `{"mcpServers":{"impeccable":{"type":"http","url":"${STAGING}","tools":["*"]}}}\n`);

  const xdg = await imp(['loop', 'connect', '--mcp-only', '--agent', 'opencode', '--json'], { XDG_CONFIG_HOME: `${H}/xdg` });
  assert.equal(xdg.status, 0, show('loop connect --mcp-only --agent opencode --json', xdg));
  clean('loop connect --mcp-only --agent opencode --json', xdg);
  assert.deepEqual(JSON.parse(xdg.stdout), {
    ok: true,
    agents: [{ agent: 'opencode', label: 'opencode', result: 'connected', added: true, signIn: 'on first use.', manualMcp: null }],
  }, show('loop connect --mcp-only --agent opencode --json', xdg));
  assert.deepEqual(JSON.parse(await read(`${H}/xdg/opencode/opencode.json`)), {
    mcp: { impeccable: { type: 'remote', url: PROD, enabled: true } },
  });

  const jsonc = '{\n  "theme": "system"\n}\n';
  await write(`${H.slice(1)}/.config/opencode/opencode.jsonc`, jsonc);
  const manual = await imp(['loop', 'connect', '--mcp-only', '--agent', 'opencode']);
  assert.equal(manual.status, 0, show('loop connect --mcp-only --agent opencode (opencode.jsonc)', manual));
  clean('loop connect --mcp-only --agent opencode (opencode.jsonc)', manual);
  assert.equal(
    manual.stdout,
    `opencode: MCP setup needs a manual step.\n  Sign in: on first use.\n  Add the impeccable MCP server (${PROD}) to ${H}/.config/opencode/opencode.jsonc.\n`,
    show('loop connect --mcp-only --agent opencode (opencode.jsonc)', manual),
  );
  assert.deepEqual(await ls(`${H}/.config/opencode`), ['opencode.jsonc']);
  assert.equal(await read(`${H}/.config/opencode/opencode.jsonc`), jsonc);

  const cursor = await imp(['loop', 'connect', '--mcp-only', '--agent', 'cursor']);
  assert.equal(cursor.status, 1, show('loop connect --mcp-only --agent cursor', cursor));
  clean('loop connect --mcp-only --agent cursor', cursor);
  assert.match(cursor.stderr, /^Cursor: not connected: \S.*\n$/, show('loop connect --mcp-only --agent cursor', cursor));
  assert.equal(cursor.stdout, '', show('loop connect --mcp-only --agent cursor', cursor));
  assert.deepEqual(JSON.parse(await read(`${H}/.cursor/mcp.json`)), { mcpServers: { impeccable: { url: PROD } } });

  const left = (await ls(`${H}/.impeccable/agents`)).filter((n) => /\.(tmp|pending\.json)$|^agents\.lock$/.test(n));
  assert.deepEqual(left, [], 'temp, pending or lock files left in ~/.impeccable/agents');
}
