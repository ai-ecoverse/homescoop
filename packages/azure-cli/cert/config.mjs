import { entraAndArm, fresh, json, ok, served, sh } from './lib/az.mjs';

// The launcher's defaults for slicc: telemetry, the survey prompt, extension
// auto-install and the first-run welcome off, each only while the user's az
// config doesn't set it (az config get shows where a value comes from), so
// az config set wins. The MSAL token cache stays plain JSON whatever the
// config says (wasix has no keyring).
export default async function (ctx) {
  const { assert } = ctx;
  const cfg = fresh('config');
  const dir = '/root/.azure-cert-config';
  const get = (key, env = '') => json(ctx, `${cfg} ${env} az config get ${key}`);
  for (const [key, value] of [['core.collect_telemetry', 'no'], ['core.survey_message', 'no'], ['extension.use_dynamic_install', 'no'], ['core.first_run', 'yes'], ['core.encrypt_token_cache', 'false']]) {
    const [section, option] = key.split('.');
    const got = await get(key);
    assert.deepEqual(got, { name: option, source: `AZURE_${section}_${option}`.toUpperCase(), value }, `${key}: ${JSON.stringify(got)}`);
  }

  // No welcome banner with its telemetry notice, no telemetry or survey files.
  const bare = await ok(ctx, `${cfg} az`);
  assert.doesNotMatch(bare.stdout, /collects usage data|Telemetry/, bare.stdout.slice(0, 800));
  assert.match(bare.stdout, /Welcome to the cool new Azure CLI!/, bare.stdout.slice(0, 800));
  // az keeps a survey schedule only when stderr is a terminal: run it in one.
  const term = (cmd) => ctx.pty(['bash', '-c', `${cfg} ${cmd}; echo "rc=$?"`], { cwd: '/root', timeoutMs: 120000, steps: [{ expect: /rc=\d+/ }] });
  const t1 = await term('az account list');
  assert.match(t1.out, /rc=0/, t1.out);
  const files = (await ok(ctx, `ls -a ${dir}`)).stdout.split('\n');
  assert.ok(!files.includes('telemetry') && !files.includes('az_survey.json'), `telemetry or survey files in ${dir}: ${files.join(' ')}`);

  // A command from an extension that isn't installed is not found, and az
  // neither looks the extension up nor offers to install it
  // (extension.use_dynamic_install=no): no request leaves the kernel.
  await ctx.serve(entraAndArm);
  const before = (await served(ctx)).length;
  const ext = await sh(ctx, `${cfg} az ssh vm --name x </dev/null`);
  assert.equal(ext.status, 2, `az ssh vm: rc=${ext.status}\n${ext.stderr}`);
  assert.match(ext.stderr, /^ERROR: 'ssh' is misspelled or not recognized by the system\.$/m, ext.stderr);
  assert.match(ext.stderr, /If the command is from an extension, please make sure the corresponding extension is installed/, ext.stderr);
  assert.doesNotMatch(ext.stderr, /Do you want to install|yes_without_prompt|Traceback/, ext.stderr);
  assert.deepEqual((await served(ctx)).slice(before).map((r) => r.url), [], 'az ssh vm made no request');

  // The user's config wins over the launcher's defaults.
  await ok(ctx, `${cfg} az config set core.survey_message=yes extension.use_dynamic_install=yes_prompt core.encrypt_token_cache=true`);
  const conf = (await ok(ctx, `cat ${dir}/config`)).stdout;
  assert.match(conf, /^survey_message = yes$/m, conf);
  const survey = await get('core.survey_message');
  assert.equal(survey.value, 'yes', JSON.stringify(survey));
  assert.equal(survey.source, `${dir}/config`);
  assert.equal((await get('extension.use_dynamic_install')).value, 'yes_prompt');
  assert.equal((await get('core.collect_telemetry')).source, 'AZURE_CORE_COLLECT_TELEMETRY', 'an option the user did not set keeps the default');
  const t2 = await term('az account list');
  assert.match(t2.out, /rc=0/, t2.out);
  assert.ok((await ok(ctx, `ls -a ${dir}`)).stdout.split('\n').includes('az_survey.json'), 'with core.survey_message=yes, az keeps its survey schedule');
  // core.encrypt_token_cache stays false: no keyring to encrypt with.
  assert.deepEqual(await get('core.encrypt_token_cache'), { name: 'encrypt_token_cache', source: 'AZURE_CORE_ENCRYPT_TOKEN_CACHE', value: 'false' });
  const env = await get('core.collect_telemetry', 'AZURE_CORE_COLLECT_TELEMETRY=yes');
  assert.equal(env.value, 'yes', 'a caller environment wins too');

  console.log(`az config get: collect_telemetry=no, survey_message=no, use_dynamic_install=no, first_run=yes, encrypt_token_cache=false from the launcher; az config set wins (survey on, az_survey.json), encrypt_token_cache stays false; az ssh vm: not found, nothing looked up or installed`);
}
