// What the New Relic CLI for slicc refuses (0003): install and diagnose
// run/update/lint stop with their reason before they reach the network or
// try to start a program. diagnose validate and the help still work.
import { KEY, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert } = ctx
  const newrelic = await asUser(ctx, 'ops')
  await stub(ctx)
  const env = { NEW_RELIC_API_KEY: KEY, NEW_RELIC_ACCOUNT_ID: '12345' }
  for (const [argv, message] of [
    [['install'], /newrelic install is not available in this build: it runs install recipes \(shell scripts, the package manager, sudo\) on the machine itself/],
    [['install', '-n', 'infrastructure-agent-installer', '-y'], /newrelic install is not available in this build/],
    [['diagnose', 'run'], /newrelic diagnose run, update and lint are not available in this build: they download and run New Relic Diagnostics \(nrdiag\)/],
    [['diagnose', 'run', '--list-suites'], /newrelic diagnose run, update and lint are not available in this build/],
    [['diagnose', 'update'], /newrelic diagnose run, update and lint are not available in this build/],
    [['diagnose', 'lint', '--config-file', 'newrelic.yml'], /newrelic diagnose run, update and lint are not available in this build/],
  ]) {
    const result = await newrelic(['newrelic', ...argv], { env })
    assert.equal(result.status, 1, `newrelic ${argv.join(' ')}: ${output(result)}`)
    assert.match(output(result), message, `newrelic ${argv.join(' ')}`)
  }
  assert.deepEqual(await requests(ctx), [], 'the refused commands make no request')
  const bin = await newrelic(['ls', '/home/ops/.newrelic/bin'])
  assert.notEqual(bin.status, 0, 'diagnose created no ~/.newrelic/bin for an nrdiag')

  const help = await newrelic(['newrelic', 'install', '--help'])
  assert.equal(help.status, 0, output(help))
  assert.match(help.stdout, /Install New Relic\./)
  const diagnose = await newrelic(['newrelic', 'diagnose', '--help'])
  assert.equal(diagnose.status, 0, output(diagnose))
  assert.match(diagnose.stdout, /validate +Validate your CLI configuration and connectivity/)
}
