/**
 * wasi-fnox without a vault: placeholders from the config, the refusals,
 * age encryption, proxy rules and plain exec. The sealed-store cases
 * (seal, request, materialize) wait for slicc-kernel's /dev/sealed (KS-2)
 * and materialize tickets (KS-8); see meta.json certPending.
 */
const AGE_RECIPIENT = 'age106n8yr50p0cgudkw03ad2e92nk4fas5m8utmw0t4lm0dlc6pqg4scqmaup';
const MISSING = 'not running in seven: /dev/sealed is missing';
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
  assert.match(ver.stdout, /^fnox 1\.39\.0/);
  const help = await fnox(['--help']);
  assert.equal(help.status, 0);
  for (const cmd of ['exec', 'get', 'set', 'proxy']) assert.match(help.stdout, new RegExp(`\\n  ${cmd} `));
  for (const cmd of ['daemon', 'tui', 'mcp']) assert.doesNotMatch(help.stdout, new RegExp(`\\n  ${cmd} `));

  const get = await fnox(['get', 'GH']);
  assert.equal(get.status, 0, `get: ${get.stderr}`);
  assert.equal(get.stdout.trim(), 'seven_ph_gh_0001');
  const sub = await fnox(['get', 'GH'], { cwd: '/home/demo/sub/dir' });
  assert.equal(sub.stdout.trim(), 'seven_ph_gh_0001', `get from a subdirectory: ${sub.stderr}`);
  const exp = await fnox(['export', '--format', 'env']);
  assert.match(exp.stdout, /^GH=seven_ph_gh_0001$/m);

  const piped = await fnox(['set', 'NEW_TOKEN'], { stdin: 'throwaway-123\n' });
  assert.notEqual(piped.status, 0);
  assert.ok(flat(piped.stderr).includes(MISSING), `set without the device: ${piped.stderr}`);
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
  assert.ok(flat(check.stdout + check.stderr).includes(MISSING), `check --all: ${check.stdout}`);

  const exec = await fnox(['exec', '--', 'printenv', 'GH']);
  assert.notEqual(exec.status, 0);
  assert.ok(flat(exec.stderr).includes(MISSING), `exec without the device: ${exec.stderr}`);

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

  await write('home/plain/fnox.toml', '[providers.plain]\ntype = "plain"\n\n[secrets]\nLOG_LEVEL = { provider = "plain", value = "debug" }\n');
  const plain = await run(['fnox', 'exec', '--', 'printenv', 'LOG_LEVEL'], { cwd: '/home/plain', env });
  assert.equal(plain.status, 0, `plain exec: ${plain.stderr}`);
  assert.equal(plain.stdout.trim(), 'debug');
  assert.match(plain.stderr, /LOG_LEVEL passed as plain values/);
  const missing = await run(['fnox', 'exec', '--', 'no-such-command'], { cwd: '/home/plain', env });
  assert.equal(missing.status, 127, `missing command: ${missing.stderr}`);
}
