export default async function (ctx) {
  const { run, write, assert } = ctx;
  const cwd = '/home/exec-filter';
  const env = { FNOX_CONFIG_DIR: '/etc/fnox-filter', NO_COLOR: '1', PWD: cwd };
  await write('etc/fnox-filter/config.toml', '');
  await write('home/exec-filter/fnox.toml', [
    '[providers.k8s]', 'type = "kubernetes"', '',
    '[providers.seven]', 'type = "sealed"', '',
    '[secrets]',
    'HOST = { default = "db.internal" }',
    'URL = { default = "postgres://${HOST}/app" }',
    'UNUSED = { provider = "k8s", value = "unreachable" }',
    'SEALED = { provider = "seven", value = "seven_ph_filter" }', '',
  ].join('\n'));
  const exec = (args, extraEnv = {}) => run(['fnox', 'exec', ...args, '--', 'printenv'], { cwd, env: { ...env, ...extraEnv } });
  const only = await exec(['--only', 'URL', '--if-missing', 'error']);
  assert.equal(only.status, 0, `exec --only resolves its dependency and skips the unavailable provider: ${only.stderr}`);
  assert.match(only.stdout, /^URL=postgres:\/\/db.internal\/app$/m);
  assert.doesNotMatch(only.stdout, /^(HOST|UNUSED|SEALED)=/m);
  const except = await exec(['--except', 'UNUSED,SEALED', '--if-missing', 'error']);
  assert.equal(except.status, 0, `exec --except skips the unavailable provider: ${except.stderr}`);
  assert.match(except.stdout, /^HOST=db.internal$/m);
  assert.match(except.stdout, /^URL=postgres:\/\/db.internal\/app$/m);
  assert.doesNotMatch(except.stdout, /^(UNUSED|SEALED)=/m);
  const sealed = await exec(['--only', 'SEALED']);
  assert.notEqual(sealed.status, 0);
  assert.notEqual(sealed.status, 134);
  assert.match(sealed.stderr, /not running in seven: \/dev\/sealed is missing|ENOTCONN: no vault is connected/);
  assert.equal(sealed.stdout, '');
  const unmatched = await exec(['--only', 'MISSING_*']);
  assert.notEqual(unmatched.status, 0);
  assert.notEqual(unmatched.status, 134);
  assert.equal(unmatched.stdout, '');
  for (const [args, extraEnv] of [[['--redact'], {}], [[], { FNOX_EXEC_REDACT: '1' }]]) {
    const redacted = await exec(args, extraEnv);
    assert.notEqual(redacted.status, 0);
    assert.notEqual(redacted.status, 134);
    assert.match(redacted.stderr, /exec output redaction is not available in seven/);
    assert.equal(redacted.stdout, '');
    assert.doesNotMatch(redacted.stderr, /panicked|wasm trap|provider type 'kubernetes'/);
  }
  const override = await exec(['--no-redact', '--only', 'URL'], { FNOX_EXEC_REDACT: '1' });
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /^URL=postgres:\/\/db.internal\/app$/m);
  await write('home/exec-filter/fnox.toml', [
    '[providers.seven]', 'type = "sealed"', '',
    '[secrets]', 'TOKEN = { provider = "seven", value = "seven_ph_filter" }', '',
    '[proxy]', 'sandbox = true', '',
    '[[proxy.rules]]', 'secret = "TOKEN"', 'domain = "api.example.com"', 'header = "authorization"', '',
  ].join('\n'));
  for (const args of [[], ['--sandbox']]) {
    const sandbox = await run(['fnox', 'proxy', 'run', ...args, '--', 'printenv'], { cwd, env });
    assert.notEqual(sandbox.status, 0);
    assert.notEqual(sandbox.status, 134);
    assert.match(sandbox.stderr, /proxy OS sandbox is not available in seven/);
    assert.equal(sandbox.stdout, '');
  }
}
