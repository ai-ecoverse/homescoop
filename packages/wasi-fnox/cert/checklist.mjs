/**
 * wasi-fnox without a vault: placeholders from the config, the refusals,
 * age encryption, proxy rules and plain exec. The sealed-store cases
 * (seal, request, materialize) wait for slicc-kernel's /dev/sealed (KS-2)
 * and materialize tickets (KS-8); see meta.json certPending.
 */
const AGE_RECIPIENT = 'age106n8yr50p0cgudkw03ad2e92nk4fas5m8utmw0t4lm0dlc6pqg4scqmaup';
// No vault: older kernels have no /dev/sealed; from 1.68.0 the device is
// there and answers ENOTCONN without the embedder's sealed hook.
const NO_VAULT = /not running in seven: \/dev\/sealed is missing|ENOTCONN: no vault is connected/;
const REFUSED = 'not available in seven: the value would be in a program (use a header rule)';
const AGE = "age secrets aren't supported in seven yet (slicc-vault#2)";
const flat = (s) => s.replace(/[\s│|]+/g, ' ');

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const env = { FNOX_CONFIG_DIR: '/etc/fnox', NO_COLOR: '1' };
  const fnox = (args, opts = {}) => run(['fnox', ...args], { cwd: '/home/demo', env, ...opts });

  await write('etc/fnox/config.toml', 'default_provider = "seven"\n\n[providers.seven]\ntype = "sealed"\n');
  await write(
    'home/demo/fnox.toml',
    [
      '[providers.team]',
      'type = "age"',
      `recipients = ["${AGE_RECIPIENT}"]`,
      '',
      '[providers.plain]',
      'type = "plain"',
      '',
      '[secrets]',
      'GH = { provider = "seven", value = "seven_ph_gh_0001" }',
      '',
      '[[proxy.rules]]',
      'secret = "GH"',
      'domain = "api.github.com"',
      'header = "authorization"',
      'env = "GITHUB_TOKEN"',
      '',
    ].join('\n'),
  );
  await write('home/demo/sub/dir/.keep', '');

  const ver = await fnox(['--version']);
  assert.equal(ver.status, 0, `--version: ${ver.stderr}`);
  assert.match(ver.stdout, /^fnox 1\.42\.0/);
  const help = await fnox(['--help']);
  assert.equal(help.status, 0);
  for (const cmd of ['exec', 'get', 'set', 'proxy']) assert.match(help.stdout, new RegExp(`\\n  ${cmd} `));
  for (const cmd of ['daemon', 'tui', 'mcp', 'plugin']) assert.doesNotMatch(help.stdout, new RegExp(`\\n  ${cmd} `));
  const add = await fnox(['provider', 'add', '--help']);
  assert.equal(add.status, 0, `provider add --help: ${add.stderr}`);
  assert.match(add.stdout, /\bsealed\b/, 'provider add offers sealed on WASI');

  const get = await fnox(['get', 'GH']);
  assert.equal(get.status, 0, `get: ${get.stderr}`);
  assert.equal(get.stdout.trim(), 'seven_ph_gh_0001');
  const sub = await fnox(['get', 'GH'], { cwd: '/home/demo/sub/dir' });
  assert.equal(sub.stdout.trim(), 'seven_ph_gh_0001', `get from a subdirectory: ${sub.stderr}`);
  const exp = await fnox(['export', '--format', 'env']);
  assert.match(exp.stdout, /^GH=seven_ph_gh_0001$/m);

  const piped = await fnox(['set', 'NEW_TOKEN'], { stdin: 'throwaway-123\n' });
  assert.notEqual(piped.status, 0);
  assert.match(flat(piped.stderr), NO_VAULT, `set without the device: ${piped.stderr}`);
  const argv = await fnox(['set', 'NEW_TOKEN', 'throwaway-123']);
  assert.notEqual(argv.status, 0);
  assert.match(flat(argv.stderr), /a value on the command line is visible to other processes/);
  const keyName = await fnox(['set', 'NEW_TOKEN', '--key-name', 'OTHER'], { stdin: 'x\n' });
  assert.notEqual(keyName.status, 0);
  assert.match(flat(keyName.stderr), /named after its secret/);

  const team = await fnox(['set', 'TEAM_KEY', '--provider', 'team'], { stdin: 'team-throwaway\n' });
  assert.equal(team.status, 0, `age set: ${team.stderr}`);
  const toml = await read('home/demo/fnox.toml');
  assert.match(toml, /TEAM_KEY/);
  assert.ok(!toml.includes('team-throwaway') && !toml.includes('throwaway-123'), 'a value reached fnox.toml');
  const ageGet = await fnox(['get', 'TEAM_KEY']);
  assert.notEqual(ageGet.status, 0);
  assert.ok(flat(ageGet.stderr).includes(AGE), `age get: ${ageGet.stderr}`);

  for (const cmd of ['sync', 'reencrypt']) {
    const r = await fnox([cmd]);
    assert.notEqual(r.status, 0, cmd);
    assert.ok(flat(r.stderr).includes(REFUSED), `${cmd}: ${r.stderr}`);
  }

  const check = await fnox(['check', '--all']);
  assert.notEqual(check.status, 0);
  assert.match(flat(check.stdout + check.stderr), NO_VAULT, `check --all: ${check.stdout}`);

  const exec = await fnox(['exec', '--', 'printenv', 'GH']);
  assert.notEqual(exec.status, 0);
  assert.match(flat(exec.stderr), NO_VAULT, `exec without the device: ${exec.stderr}`);

  const shell = await fnox(['exec', '--shell-grants', '--', 'printenv', 'HOME']);
  assert.notEqual(shell.status, 0);
  assert.match(flat(shell.stderr), NO_VAULT, `exec --shell-grants without the device: ${shell.stderr}`);

  const rules = await fnox(['proxy', 'rules', '--json']);
  assert.equal(rules.status, 0, `proxy rules --json: ${rules.stderr}`);
  const parsed = JSON.parse(rules.stdout);
  assert.equal(parsed.egress, 'strict');
  assert.deepEqual(
    parsed.rules.map((r) => [r.secret, r.domain, r.env, r.header]),
    [['GH', 'api.github.com', 'GITHUB_TOKEN', 'authorization']],
  );
  const proxied = await fnox(['proxy', 'run', '--', 'printenv', 'GITHUB_TOKEN']);
  assert.equal(proxied.status, 0, `proxy run: ${proxied.stderr}`);
  assert.equal(proxied.stdout.trim(), 'seven_ph_gh_0001');
  const scrubbed = await fnox(['proxy', 'run', '--', 'printenv', 'GH']);
  assert.notEqual(scrubbed.status, 0, 'the secret name itself must be scrubbed in proxy run');

  // homescoop#401: providers the WASI build compiles out keep their
  // env_dependencies(), so proxy run removes a configured provider's
  // credentials from the child as upstream does. The FNOX_* names and
  // VAULT_NAMESPACE are only in those lists, not in proxy's fixed one.
  await write(
    'home/scrub/fnox.toml',
    [
      '[providers.seven]', 'type = "sealed"', '',
      '[providers.op]', 'type = "1password"', '',
      '[providers.bw]', 'type = "bitwarden"', '',
      '[providers.vault]', 'type = "vault"', 'address = "https://vault.example"', '',
      '[providers.inf]', 'type = "infisical"', '',
      '[secrets]', 'GH = { provider = "seven", value = "seven_ph_gh_0001" }', '',
      '[[proxy.rules]]', 'secret = "GH"', 'domain = "api.github.com"', 'header = "authorization"', 'env = "GITHUB_TOKEN"', '',
    ].join('\n'),
  );
  const creds = {
    OP_SERVICE_ACCOUNT_TOKEN: 'ops_ambient',
    FNOX_OP_SERVICE_ACCOUNT_TOKEN: 'fnox_ops_ambient',
    BW_SESSION: 'bw_ambient',
    FNOX_BW_SESSION: 'fnox_bw_ambient',
    VAULT_TOKEN: 'vault_ambient',
    FNOX_VAULT_NAMESPACE: 'fnox_ns_ambient',
    INFISICAL_CLIENT_SECRET: 'inf_secret_ambient',
    FNOX_INFISICAL_TOKEN: 'fnox_inf_ambient',
  };
  const scrub = await run(['fnox', 'proxy', 'run', '--', 'printenv'], { cwd: '/home/scrub', env: { ...env, ...creds } });
  assert.equal(scrub.status, 0, `proxy run with provider credentials: ${scrub.stderr}`);
  assert.match(scrub.stdout, /^GITHUB_TOKEN=seven_ph_gh_0001$/m);
  for (const name of Object.keys(creds)) {
    assert.doesNotMatch(scrub.stdout, new RegExp(`^${name}=`, 'm'), `proxy run handed ${name} to the child (homescoop#401)`);
  }

  await write('home/v140/.env', 'FROMFILE=from-the-file\n');
  await write('home/v140/conf/secrets.json', '{"FROMJSON": "from-the-json-file"}\n');
  await write('home/v140/sub/dir/.keep', '');
  await write(
    'home/v140/fnox.toml',
    [
      '[providers.k8s]', 'type = "kubernetes"', '',
      '[providers.lua]', 'type = "lua"', 'plugin = "my-plugin"', '',
      '[providers.envfile]', 'type = "plain"', 'file = "/home/v140/.env"', 'format = "env"', '',
      '[providers.jsonfile]', 'type = "plain"', 'file = "conf/secrets.json"', 'format = "json"', '',
      '[secrets]',
      'K8S = { provider = "k8s", value = "app-secret" }',
      'LUA = { provider = "lua", value = "app-secret" }',
      'FROMFILE = { provider = "envfile", value = "FROMFILE" }',
      'FROMJSON = { provider = "jsonfile", value = "FROMJSON" }', '',
    ].join('\n'),
  );
  const fromFile = await run(['fnox', 'get', 'FROMFILE'], { cwd: '/home/v140', env });
  assert.equal(fromFile.status, 0, `1.40.0 plain provider with a file: ${fromFile.stderr}`);
  assert.equal(fromFile.stdout.trim(), 'from-the-file', `1.40.0 plain provider reads the value from its file: ${fromFile.stdout}`);
  for (const cwd of ['/home/v140', '/home/v140/sub/dir']) {
    const rel = await run(['fnox', 'get', 'FROMJSON'], { cwd, env: { ...env, PWD: cwd } });
    assert.equal(rel.status, 0, `1.40.0 plain provider with a relative json file, from ${cwd}: ${rel.stderr}`);
    assert.equal(rel.stdout.trim(), 'from-the-json-file', `1.40.0 a relative plain file is read from the config's directory, not the cwd (${cwd}): ${rel.stdout}`);
  }
  for (const [key, type] of [['K8S', 'kubernetes'], ['LUA', 'lua']]) {
    const r = await run(['fnox', 'get', key], { cwd: '/home/v140', env });
    assert.notEqual(r.status, 0, `1.40.0 ${type} provider must fail in the WASI build`);
    assert.notEqual(r.status, 134, `1.40.0 ${type} provider trapped: ${r.stderr}`);
    assert.ok(flat(r.stderr).includes(`provider type '${type}' is not available in the WASI build of fnox`), `1.40.0 ${type} provider: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /panicked|wasm trap/);
  }
  const pluginCmd = await run(['fnox', 'plugin', 'list'], { cwd: '/home/v140', env });
  assert.notEqual(pluginCmd.status, 0, 'fnox plugin is not built on WASI');
  assert.notEqual(pluginCmd.status, 134, `fnox plugin trapped: ${pluginCmd.stderr}`);
  await write(
    'home/v140scrub/fnox.toml',
    [
      '[providers.seven]', 'type = "sealed"', '',
      '[providers.k8s]', 'type = "kubernetes"', '',
      '[providers.lua]', 'type = "lua"', 'plugin = "my-plugin"', '',
      '[providers.azsm]', 'type = "azure-sm"', 'vault_url = "https://example.vault.azure.net"', '',
      '[secrets]', 'GH = { provider = "seven", value = "seven_ph_gh_0001" }', '',
      '[[proxy.rules]]', 'secret = "GH"', 'domain = "api.github.com"', 'header = "authorization"', 'env = "GITHUB_TOKEN"', '',
    ].join('\n'),
  );
  const k8sCreds = {
    FNOX_K8S_CONTEXT: 'k8s_context_ambient',
    KUBECONFIG: '/home/v140scrub/kubeconfig',
    AZURE_TENANT_ID: 'az_tenant_ambient',
    AZURE_CLIENT_ID: 'az_client_ambient',
    AZURE_CLIENT_SECRET: 'az_secret_ambient',
  };
  const scrub140 = await run(['fnox', 'proxy', 'run', '--', 'printenv'], { cwd: '/home/v140scrub', env: { ...env, ...k8sCreds } });
  assert.equal(scrub140.status, 0, `1.40.0 proxy run with kubernetes, lua and azure-sm providers: ${scrub140.stderr}`);
  assert.match(scrub140.stdout, /^GITHUB_TOKEN=seven_ph_gh_0001$/m);
  for (const name of Object.keys(k8sCreds)) {
    assert.doesNotMatch(scrub140.stdout, new RegExp(`^${name}=`, 'm'), `proxy run handed a configured provider's ${name} to the child (homescoop#401)`);
  }

  await write('home/v141gp/fnox.toml', '[providers.gp]\ntype = "gopass"\nmount = "company"\n\n[secrets]\nGP = { provider = "gp", value = "apps/db" }\n');
  const gp = await run(['fnox', 'get', 'GP'], { cwd: '/home/v141gp', env });
  assert.notEqual(gp.status, 0, '1.41.0 gopass provider must fail in the WASI build');
  assert.notEqual(gp.status, 134, `1.41.0 gopass provider trapped: ${gp.stderr}`);
  assert.ok(flat(gp.stderr).includes("provider type 'gopass' is not available in the WASI build of fnox"), `1.41.0 gopass provider: ${gp.stderr}`);
  assert.doesNotMatch(gp.stderr, /panicked|wasm trap/);
  await write('home/v141/conf/default.json', '{"TOKEN": "token-for-default"}\n');
  await write('home/v141/conf/staging.json', '{"TOKEN": "token-for-staging"}\n');
  await write(
    'home/v141/fnox.toml',
    [
      '[providers.tplfile]', 'type = "plain"', 'file = "conf/{{ fnox.profile }}.json"', 'format = "json"', '',
      '[secrets]',
      'STAGE = { default = "{{ fnox.profile }}" }',
      'RAW = { default = "{% raw %}{{ literal }}{% endraw %}" }',
      'BAD = { default = "{{ nope }}" }',
      'TPLTOKEN = { provider = "tplfile", value = "TOKEN" }', '',
      '[profiles.staging]', '',
    ].join('\n'),
  );
  const v141 = (args) => run(['fnox', ...args], { cwd: '/home/v141', env: { ...env, PWD: '/home/v141' } });
  for (const [args, want] of [
    [['get', 'STAGE'], 'default'],
    [['-P', 'staging', 'get', 'STAGE'], 'staging'],
    [['get', 'RAW'], '{{ literal }}'],
    [['get', 'TPLTOKEN'], 'token-for-default'],
    [['-P', 'staging', 'get', 'TPLTOKEN'], 'token-for-staging'],
  ]) {
    const r = await v141(args);
    assert.equal(r.status, 0, `1.41.0 template, fnox ${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), want, `1.41.0 template, fnox ${args.join(' ')}: ${r.stdout}`);
  }
  const bad = await v141(['get', 'BAD']);
  assert.notEqual(bad.status, 0, '1.41.0 a default with an undefined template variable must fail');
  assert.notEqual(bad.status, 134, `1.41.0 a bad template trapped: ${bad.stderr}`);
  assert.ok(flat(bad.stderr).includes("default of secret 'BAD'"), `1.41.0 a bad template names the field: ${bad.stderr}`);
  assert.doesNotMatch(bad.stderr, /panicked|wasm trap/);
  await write('home/v141exec/conf/staging.json', '{"TOKEN": "token-for-staging"}\n');
  await write(
    'home/v141exec/fnox.toml',
    [
      '[providers.tplfile]', 'type = "plain"', 'file = "conf/{{ fnox.profile }}.json"', 'format = "json"', '',
      '[secrets]',
      'STAGE = { default = "{{ fnox.profile }}" }',
      'TPLTOKEN = { provider = "tplfile", value = "TOKEN" }', '',
      '[profiles.staging]', '',
    ].join('\n'),
  );
  const execTpl = await run(['fnox', '-P', 'staging', 'exec', '--', 'printenv', 'STAGE', 'TPLTOKEN'], { cwd: '/home/v141exec', env: { ...env, PWD: '/home/v141exec' } });
  assert.equal(execTpl.status, 0, `1.41.0 exec with templated secrets: ${execTpl.stderr}`);
  assert.equal(execTpl.stdout, 'staging\ntoken-for-staging\n', `1.41.0 exec hands the rendered templates to the command: ${execTpl.stdout}`);
  assert.doesNotMatch(execTpl.stderr, /panicked|wasm trap/);
  await write(
    'home/v141unused/fnox.toml',
    [
      '[providers.k8s]', 'type = "kubernetes"', '',
      '[secrets]',
      'LVL = { default = "debug" }',
      'UNUSED = { provider = "k8s", value = "app-secret", env = false }', '',
    ].join('\n'),
  );
  const unusedEnv = { ...env, PWD: '/home/v141unused', UNUSED: 'unused_ambient' };
  const execUsed = await run(['fnox', 'exec', '--if-missing', 'error', '--', 'printenv', 'LVL'], { cwd: '/home/v141unused', env: unusedEnv });
  assert.equal(execUsed.status, 0, `1.41.0 exec resolves only what it injects, not an unused env = false secret: ${execUsed.stderr}`);
  assert.equal(execUsed.stdout, 'debug\n', `1.41.0 exec with an unused env = false secret: ${execUsed.stdout}`);
  assert.doesNotMatch(execUsed.stderr, /panicked|wasm trap/);
  const execUnused = await run(['fnox', 'exec', '--', 'printenv', 'UNUSED'], { cwd: '/home/v141unused', env: unusedEnv });
  assert.notEqual(execUnused.status, 0, `1.41.0 exec still removes an env = false secret's name from the command's environment: ${execUnused.stdout}`);
  assert.doesNotMatch(execUnused.stdout, /unused_ambient/);
  await write(
    'home/v141scrub/fnox.toml',
    [
      '[providers.seven]', 'type = "sealed"', '',
      '[providers.gp]', 'type = "gopass"', '',
      '[secrets]', 'GH = { provider = "seven", value = "seven_ph_gh_0001" }', '',
      '[[proxy.rules]]', 'secret = "GH"', 'domain = "api.github.com"', 'header = "authorization"', 'env = "GITHUB_TOKEN"', '',
    ].join('\n'),
  );
  const gopassCreds = {
    GNUPGHOME: '/home/v141scrub/gnupg',
    GOPASS_HOMEDIR: '/home/v141scrub/gopass',
    GOPASS_CONFIG_NOWRAP: 'gopass_nowrap_ambient',
  };
  const scrub141 = await run(['fnox', 'proxy', 'run', '--', 'printenv'], { cwd: '/home/v141scrub', env: { ...env, ...gopassCreds } });
  assert.equal(scrub141.status, 0, `1.41.0 proxy run with a gopass provider: ${scrub141.stderr}`);
  assert.match(scrub141.stdout, /^GITHUB_TOKEN=seven_ph_gh_0001$/m);
  for (const name of Object.keys(gopassCreds)) {
    assert.doesNotMatch(scrub141.stdout, new RegExp(`^${name}=`, 'm'), `proxy run handed a configured gopass provider's ${name} to the child (homescoop#401)`);
  }

  await write(
    'home/v142exp/fnox.toml',
    [
      '[providers.k8s]', 'type = "kubernetes"', '',
      '[secrets]',
      'GH = { provider = "seven", value = "seven_ph_gh_0142" }',
      'LVL = { default = "debug" }',
      'HOST = { default = "db.internal" }',
      'URL = { default = "postgres://${HOST}/app" }',
      'HIDDEN = { default = "hidden-value", env = false }',
      'GF = { provider = "seven", value = "seven_ph_gf_0142", as_file = true }',
      'UNUSED = { provider = "k8s", value = "app-secret" }', '',
    ].join('\n'),
  );
  const v142 = (args) => run(['fnox', ...args], { cwd: '/home/v142exp', env: { ...env, PWD: '/home/v142exp' } });
  const lines = (s) => s.split('\n').filter(Boolean);
  const expAll = await v142(['export', '--if-missing', 'error']);
  assert.notEqual(expAll.status, 0, `1.42.0 export without keys still resolves the unresolvable UNUSED: ${expAll.stdout}`);
  assert.notEqual(expAll.status, 134, `1.42.0 export without keys trapped: ${expAll.stderr}`);
  const expOne = await v142(['export', '--if-missing', 'error', 'LVL']);
  assert.equal(expOne.status, 0, `1.42.0 export of a named key resolves only that key, not UNUSED: ${expOne.stderr}`);
  assert.deepEqual(lines(expOne.stdout), ['LVL=debug'], `1.42.0 export LVL prints only LVL: ${expOne.stdout}`);
  assert.doesNotMatch(expOne.stderr, /panicked|wasm trap/);
  const expJson = await v142(['export', '--if-missing', 'error', '--format', 'json', 'URL', 'GH']);
  assert.equal(expJson.status, 0, `1.42.0 export --format json URL GH: ${expJson.stderr}`);
  const expJsonSecrets = expJson.status === 0 ? JSON.parse(expJson.stdout).secrets : null;
  assert.deepEqual(expJsonSecrets, { URL: 'postgres://db.internal/app', GH: 'seven_ph_gh_0142' }, `1.42.0 export of named keys: the interpolated HOST is resolved but not exported, the sealed GH is its placeholder: ${expJson.stdout}`);
  const expHidden = await v142(['export', '--if-missing', 'error', 'HIDDEN']);
  assert.equal(expHidden.status, 0, `1.42.0 export of a named env = false key: ${expHidden.stderr}`);
  assert.deepEqual(lines(expHidden.stdout), ['HIDDEN=hidden-value'], `1.42.0 a named env = false secret is exported: ${expHidden.stdout}`);
  const expFileNamed = await v142(['export', '--if-missing', 'error', 'GF']);
  assert.equal(expFileNamed.status, 0, `1.42.0 export of a named sealed as_file key: ${expFileNamed.stderr}`);
  assert.deepEqual(lines(expFileNamed.stdout), ['GF=seven_ph_gf_0142'], `1.42.0 a named sealed as_file secret exports only its placeholder: ${expFileNamed.stdout}`);
  const expUnknown = await v142(['export', 'LVX']);
  assert.notEqual(expUnknown.status, 0, `1.42.0 export of an unknown key must fail: ${expUnknown.stdout}`);
  assert.notEqual(expUnknown.status, 134, `1.42.0 export of an unknown key trapped: ${expUnknown.stderr}`);
  assert.ok(flat(expUnknown.stderr).includes("Did you mean 'LVL'?"), `1.42.0 export of an unknown key suggests LVL: ${expUnknown.stderr}`);
  assert.equal(expUnknown.stdout, '', `1.42.0 export of an unknown key prints nothing: ${expUnknown.stdout}`);

  await write(
    'home/v142lease/fnox.toml',
    [
      '[secrets]', 'LVL = { default = "debug" }', '',
      '[leases.az]', 'type = "azure-token"', 'scope = "https://ai.azure.com/.default"', 'env_var = "AI_ACCESS_TOKEN"',
      'auth = "managed-identity"', 'managed_identity_client_id = "00000000-0000-0000-0000-000000000000"', '',
    ].join('\n'),
  );
  for (const args of [['exec', '--', 'printenv', 'LVL'], ['get', 'AI_ACCESS_TOKEN']]) {
    const r = await run(['fnox', ...args], { cwd: '/home/v142lease', env: { ...env, PWD: '/home/v142lease' } });
    assert.notEqual(r.status, 0, `1.42.0 azure-token lease with managed identity, fnox ${args.join(' ')}, must fail in the WASI build: ${r.stdout}`);
    assert.notEqual(r.status, 134, `1.42.0 azure-token managed identity trapped, fnox ${args.join(' ')}: ${r.stderr}`);
    assert.ok(flat(r.stderr).includes('leases are not available in the WASI build of fnox'), `1.42.0 azure-token managed identity, fnox ${args.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /panicked|wasm trap/);
    assert.equal(r.stdout, '', `1.42.0 azure-token managed identity, fnox ${args.join(' ')}, prints nothing: ${r.stdout}`);
  }
  const syncLocal = await fnox(['sync', '--local-file']);
  assert.notEqual(syncLocal.status, 0, 'sync --local-file');
  assert.ok(flat(syncLocal.stderr).includes(REFUSED), `1.42.0 sync --local-file: ${syncLocal.stderr}`);

  await write('home/plain/fnox.toml', '[providers.plain]\ntype = "plain"\n\n[secrets]\nLOG_LEVEL = { provider = "plain", value = "debug" }\n');
  const plain = await run(['fnox', 'exec', '--', 'printenv', 'LOG_LEVEL'], { cwd: '/home/plain', env });
  assert.equal(plain.status, 0, `plain exec: ${plain.stderr}`);
  assert.equal(plain.stdout.trim(), 'debug');
  assert.match(plain.stderr, /LOG_LEVEL passed as plain values/);
  const edit = await run(['fnox', 'edit'], { cwd: '/home/plain', env: { ...env, EDITOR: 'true' } });
  assert.notEqual(edit.status, 134, `fnox edit trapped: ${edit.stderr}`);
  assert.notEqual(edit.status, 0, 'fnox edit must fail');
  assert.ok(flat(edit.stderr).includes('fnox edit is not available in seven: use fnox set'), `fnox edit: ${edit.stderr}`);
  assert.doesNotMatch(edit.stderr, /panicked|wasm trap/);
  const missing = await run(['fnox', 'exec', '--', 'no-such-command'], { cwd: '/home/plain', env });
  assert.equal(missing.status, 127, `missing command: ${missing.stderr}`);

  // homescoop#400: the shell integration. hook-env (what activate's prompt
  // hook runs) trapped on std::process::id(); activate printed a bare
  // `fnox`, which the fnox() wrapper it defines would call recursively.
  // An as_file secret is refused (no file in seven) and skipped.
  await write(
    'home/hook/fnox.toml',
    '[providers.plain]\ntype = "plain"\n\n[secrets]\nLVL = { provider = "plain", value = "debug" }\nCERT = { provider = "plain", value = "pem-data", as_file = true }\n',
  );
  const hook = await run(['fnox', 'hook-env', '-s', 'bash'], { cwd: '/home/hook', env });
  assert.notEqual(hook.status, 134, `hook-env trapped: ${hook.stderr}`);
  assert.equal(hook.status, 0, `hook-env: ${hook.stderr}`);
  assert.doesNotMatch(hook.stderr, /panicked|wasm trap/);
  assert.match(hook.stdout, /^export LVL=debug$/m);
  assert.match(hook.stdout, /^export __FNOX_SESSION=\S+$/m);
  assert.doesNotMatch(hook.stdout, /CERT|pem-data/, 'an as_file secret reached the shell');
  assert.ok(flat(hook.stderr).includes(`'CERT': ${REFUSED}`), `hook-env as_file: ${hook.stderr}`);
  const activate = await run(['fnox', 'activate', 'bash'], { cwd: '/home/hook', env });
  assert.equal(activate.status, 0, `activate: ${activate.stderr}`);
  assert.match(activate.stdout, /eval "\$\(\/usr\/bin\/fnox hook-env -s bash\)"/);
  assert.doesNotMatch(activate.stdout, /(^|[\s(])fnox "\$command"/m, 'activate calls a bare fnox inside its fnox() wrapper');
  const noPath = await run(['/usr/bin/fnox', 'activate', 'bash'], { cwd: '/home/hook', env: { ...env, PATH: '/nonexistent' } });
  assert.equal(noPath.status, 0, `activate with no fnox on PATH: ${noPath.stderr}`);
  assert.match(noPath.stdout, /eval "\$\(\/usr\/bin\/fnox hook-env -s bash\)"/, `activate with no fnox on PATH: ${noPath.stdout}`);
  assert.doesNotMatch(noPath.stdout, /(^|[\s(])fnox "\$command"/m, 'activate with no fnox on PATH calls a bare fnox inside its fnox() wrapper');
  // homescoop#1129 (1.39.0-6, 0016): a fnox earlier on PATH that isn't
  // executable is passed over; activate names the one the kernel would run.
  await write('tmp/bin/fnox', '#!/bin/sh\necho not-fnox\n');
  await run(['chmod', '644', '/tmp/bin/fnox'], { cwd: '/' });
  const shadow = await run(['fnox', 'activate', 'bash'], { cwd: '/home/hook', env: { ...env, PATH: '/tmp/bin:/usr/bin:/bin' } });
  assert.equal(shadow.status, 0, `activate with a non-executable fnox first on PATH: ${shadow.stderr}`);
  assert.match(shadow.stdout, /eval "\$\(\/usr\/bin\/fnox hook-env -s bash\)"/, `#1129 activate skips /tmp/bin/fnox (mode 644): ${shadow.stdout.slice(0, 400)}`);
  assert.doesNotMatch(shadow.stdout, /\/tmp\/bin\/fnox/, '#1129 the non-executable fnox is not pinned into the hook');
  await run(['chmod', '755', '/tmp/bin/fnox'], { cwd: '/' });
  const shadowX = await run(['fnox', 'activate', 'bash'], { cwd: '/home/hook', env: { ...env, PATH: '/tmp/bin:/usr/bin:/bin' } });
  assert.match(shadowX.stdout, /\/tmp\/bin\/fnox hook-env/, `#1129 an executable fnox first on PATH is the one named: ${shadowX.stdout.slice(0, 400)}`);
  // homescoop#945 (1.39.0-6, 0016): exec in a project with an as_file
  // secret runs the command; the as_file secret is left unset, with a
  // warning naming it, instead of the whole command being refused.
  const execFile = await run(['fnox', 'exec', '--', 'printenv', 'LVL'], { cwd: '/home/hook', env });
  assert.equal(execFile.status, 0, `#945 fnox exec with an as_file secret in the project: ${execFile.stderr}`);
  assert.equal(execFile.stdout, 'debug\n', `#945 the plain secret reaches the command: ${execFile.stdout}`);
  assert.match(execFile.stderr, /CERT is not set: it is an as_file secret/, `#945 the as_file secret is named in a warning: ${execFile.stderr}`);
  assert.doesNotMatch(execFile.stderr, /the value would be in a program/, '#945 not the misleading refusal');
  const execCert = await run(['fnox', 'exec', '--', 'printenv', 'CERT'], { cwd: '/home/hook', env });
  assert.notEqual(execCert.status, 0, `#945 the as_file secret isn't in the command's environment: ${execCert.stdout}`);
  assert.doesNotMatch(execCert.stdout, /pem-data/);
  const expFile = await run(['fnox', 'export', '--format', 'env'], { cwd: '/home/hook', env });
  assert.equal(expFile.status, 0, `export with an as_file secret: ${expFile.stderr}`);
  assert.notEqual(expFile.status, 134, `export as_file trapped: ${expFile.stderr}`);
  assert.match(expFile.stdout, /^CERT=pem-data$/m, `export prints an as_file secret's value, as upstream does when the file can't be written: ${expFile.stdout}`);
  assert.match(expFile.stdout, /^LVL=debug$/m);
  const bash = await run(
    [
      'bash',
      '-c',
      'eval "$(fnox activate bash)"; _fnox_hook; echo "in=$LVL"; cd /; _fnox_hook; echo "out=${LVL-unset}"; cd /home/hook; _fnox_hook; fnox deactivate; echo "rc=$? off=${LVL-unset} ${__FNOX_SESSION-nosession}"',
    ],
    { cwd: '/home/hook', env: { ...env, PWD: '/home/hook' } },
  );
  assert.equal(bash.status, 0, `activate in bash: ${bash.stderr}`);
  assert.doesNotMatch(bash.stderr, /panicked|wasm trap|RangeError/);
  assert.equal(bash.stdout, 'in=debug\nout=unset\nrc=0 off=unset nosession\n', `activate in bash: ${bash.stderr}`);
  const getFile = await run(['fnox', 'get', 'CERT'], { cwd: '/home/hook', env });
  assert.notEqual(getFile.status, 0, 'get of an as_file secret must fail in seven');
  assert.notEqual(getFile.status, 134, `get as_file trapped: ${getFile.stderr}`);
  assert.ok(flat(getFile.stderr).includes(REFUSED), `get as_file: ${getFile.stderr}`);
}
