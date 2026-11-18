import { entraAndArm, fresh, json, ok, sh } from './lib/az.mjs';
import { installProbe } from './lib/probe.mjs';

const PY = '/node_modules/@ai-ecoverse';

// The command modules that need native code at import (2.93.0-1 stopped
// each with one "This command needs ..." ERROR line) run: each is an ARM
// list against the stand-in (an empty list), or for az bot a call that
// reaches ARM (the stand-in has no bot, so Not Found). In az's own process
// (an extension's probe), cryptography with its _rust, _cffi_backend, PyNaCl
// with its _sodium, bcrypt, pycparser and pyOpenSSL come from the py-*
// packages package.json pins, and paramiko, fabric, invoke, scp and sshtunnel
// from lib/azure-cli. psutil stays out: az imports it in a try (here: az rest
// with a key=value header, which az first tries as JSON, and a JSON error
// asks for the parent process), so the call works and --debug shows the
// launcher's one-line reason, with no traceback.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('native');
  await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);

  const lists = [
    'keyvault list', // cryptography
    'iot hub list', // cryptography
    'sf cluster list', // pyOpenSSL
    'batchai cluster list -g cert-rg -w certws', // paramiko, sshtunnel
    'ams content-key-policy list -g cert-rg -a certams', // cryptography
    'webapp list', // PyNaCl, fabric, paramiko
    'functionapp list',
    'logicapp list',
    'staticwebapp list',
  ];
  for (const c of lists) {
    const r = await sh(ctx, `${cfg} az ${c}`);
    assert.equal(r.status, 0, `az ${c}: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), [], `az ${c}: ${r.stdout}`);
    assert.doesNotMatch(r.stderr, /ERROR|Traceback|This command needs/, `az ${c}:\n${r.stderr}`);
  }
  const bot = await sh(ctx, `${cfg} az bot show -g cert-rg -n certbot`);
  assert.equal(bot.status, 3, `az bot show: rc=${bot.status}\n${bot.stderr}`);
  assert.match(bot.stderr, /^ERROR: Operation returned an invalid status 'Not Found'$/m, bot.stderr);
  assert.doesNotMatch(bot.stderr, /Traceback|This command needs/, bot.stderr);

  await installProbe(ctx, '/root/.azure-cert-native');
  const where = await json(ctx, `${cfg} az certprobe where`);
  const m = where.modules;
  const from = {
    cryptography: `${PY}/py-cryptography/lib/python3.15/site-packages/cryptography/__init__.py`,
    'cryptography.hazmat.bindings._rust': `${PY}/py-cryptography/lib/python3.15/site-packages/cryptography/hazmat/bindings/_rust.cpython-315-wasm32-wasix.so`,
    _cffi_backend: `${PY}/py-cffi/lib/python3.15/site-packages/_cffi_backend.cpython-315-wasm32-wasix.so`,
    cffi: `${PY}/py-cffi/lib/python3.15/site-packages/cffi/__init__.py`,
    pycparser: `${PY}/py-pycparser/lib/python3/site-packages/pycparser/__init__.py`,
    nacl: `${PY}/py-pynacl/lib/python3.15/site-packages/nacl/__init__.py`,
    'nacl._sodium': `${PY}/py-pynacl/lib/python3.15/site-packages/nacl/_sodium.cpython-315-wasm32-wasix.so`,
    bcrypt: `${PY}/py-bcrypt/lib/python3.15/site-packages/bcrypt/__init__.py`,
    OpenSSL: `${PY}/py-pyopenssl/lib/python3/site-packages/OpenSSL/__init__.py`,
    paramiko: `${PY}/azure-cli/lib/azure-cli/paramiko/__init__.py`,
    fabric: `${PY}/azure-cli/lib/azure-cli/fabric/__init__.py`,
    invoke: `${PY}/azure-cli/lib/azure-cli/invoke/__init__.py`,
    scp: `${PY}/azure-cli/lib/azure-cli/scp.py`,
    sshtunnel: `${PY}/azure-cli/lib/azure-cli/sshtunnel.py`,
  };
  for (const [mod, file] of Object.entries(from)) assert.equal(m[mod], file, `${mod} in az's process: ${m[mod]}`);
  // The py-* directories come after az's tree and the standard library, and
  // no other site-packages is on the path.
  const site = where.path.filter((p) => /site-packages/.test(p));
  assert.deepEqual(site, [
    `${PY}/py-bcrypt/lib/python3.15/site-packages`,
    `${PY}/py-cffi/lib/python3.15/site-packages`,
    `${PY}/py-cryptography/lib/python3.15/site-packages`,
    `${PY}/py-pycparser/lib/python3/site-packages`,
    `${PY}/py-pynacl/lib/python3.15/site-packages`,
    `${PY}/py-pyopenssl/lib/python3/site-packages`,
  ], JSON.stringify(where.path));
  assert.equal(where.path[0], `${PY}/azure-cli/lib/azure-cli`);

  // psutil: az rest tries the header as JSON first; the JSON error asks for
  // the parent process's name, psutil's import fails in az's try.
  const rest = await sh(ctx, `${cfg} az rest --url "https://management.azure.com/subscriptions?api-version=2022-12-01" --headers x-cert=1 --debug`);
  assert.equal(rest.status, 0, `az rest: rc=${rest.status}\n${rest.stderr.slice(-3000)}`);
  assert.equal(JSON.parse(rest.stdout).value[0].subscriptionId, 'aaaa0000-0000-4000-8000-000000000001');
  assert.match(rest.stderr, /^DEBUG: cli\.azure\.cli\.core\.util: This command needs psutil \(native code\), which has no WASIX build; @ai-ecoverse\/azure-cli doesn't include it \(No module named 'psutil'\)\.$/m, rest.stderr.slice(-6000));
  assert.doesNotMatch(rest.stderr, /Traceback/, rest.stderr.slice(-6000));
  console.log(`az ${lists.map((c) => c.split(' ').slice(0, c.startsWith('ams') ? 2 : 1).join(' ')).join(', az ')} run (ARM lists), az bot reaches ARM; in az's process cryptography, _cffi_backend, cffi, pycparser, PyNaCl, bcrypt and pyOpenSSL come from their py-* packages, paramiko, fabric, invoke, scp and sshtunnel from lib/azure-cli, and only those six site-packages are on sys.path; psutil's import fails in az's try with the launcher's reason (az rest --headers key=value --debug), no traceback`);
}
