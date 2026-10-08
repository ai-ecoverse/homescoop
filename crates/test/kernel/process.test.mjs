// wasix-command and wasix-net's sockets inside the kernel: spawn, pipes,
// wait / kill, a detached child, and loopback TCP and HTTP between
// processes.
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { kernelWithSelftest, output } from './harness.mjs'

test('spawn: exit codes, pipes, stdin, env, cwd, files, try_wait and kill', async () => {
  const kernel = await kernelWithSelftest()
  try {
    const result = await kernel.run(['wasix-selftest', 'spawn'], { cwd: '/tmp' })
    assert.equal(result.status, 0, output(result))
    const lines = result.stdout.trim().split('\n')
    assert.ok(lines.every(l => l.startsWith('ok ')), output(result))
    assert.equal(lines.length, 16, output(result))
  } finally {
    kernel.terminate()
  }
})

test('loopback: TCP and HTTP between a process and its child', async () => {
  const kernel = await kernelWithSelftest()
  try {
    const result = await kernel.run(['wasix-selftest', 'loopback'], { cwd: '/tmp' })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /^ok HTTP over loopback$/m, output(result))
  } finally {
    kernel.terminate()
  }
})

test('a detached child outlives its parent', async () => {
  const kernel = await kernelWithSelftest()
  try {
    const result = await kernel.run(['wasix-selftest', 'detach', '/tmp/detached'], { cwd: '/tmp' })
    assert.equal(result.status, 0, output(result))
    assert.match(result.stdout, /^detached \d+$/m)
    let text
    for (let i = 0; i < 100 && text === undefined; i++) {
      await sleep(100)
      text = await kernel.readFile('/tmp/detached').then(b => new TextDecoder().decode(b), () => undefined)
    }
    assert.equal(text, 'alive\n', 'the detached child never wrote its file')
  } finally {
    kernel.terminate()
  }
})
