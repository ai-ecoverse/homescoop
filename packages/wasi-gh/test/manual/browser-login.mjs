// Headed check for GH_BROWSER=playwright-cli open.
//
// Launches system Chrome on a debugging port other than 9222, bridges that
// socket into slicc-kernel's CDP listener, and runs:
//   yes | gh auth login -w -p https -c
// stdin is a finite run of "y" lines, which is enough to keep gh off the
// survey TUI. The browser command does not inherit that pipe.
//
// From the homescoop root, after packages/wasi-gh/build.sh:
//   node packages/wasi-gh/test/manual/browser-login.mjs
//
// The GitHub one-time code is printed. The saved oauth token is not.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node'

const here = fileURLToPath(new URL('.', import.meta.url))
const ghPackage = path.resolve(here, '../../package')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const redact = text => text
  .replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, '[redacted-token]')
  .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[redacted-token]')
  .replace(/(oauth_token:\s*)\S+/g, '$1[redacted-token]')

function freePort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function launchChrome () {
  let port = await freePort()
  if (port === 9222) port = await freePort()
  if (port === 9222) throw new Error('refusing to bind the kernel CDP port')
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'wasi-gh-chrome-'))
  let chromeLog = ''
  const child = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', chunk => {
    chromeLog = (chromeLog + chunk.toString('utf8')).slice(-4000)
  })
  const stop = () => {
    if (child.exitCode !== null || child.signalCode) return
    child.kill('SIGKILL')
  }
  const deadline = Date.now() + 20000
  let last = 'no response'
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`Chrome exited before /json/version\n${chromeLog}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const version = await response.json()
        const wsUrl = version.webSocketDebuggerUrl
        if (typeof wsUrl !== 'string' || !wsUrl.startsWith('ws://') || wsUrl.includes(':9222/')) {
          throw new Error(`unexpected debugger url ${wsUrl}`)
        }
        return {
          port,
          wsUrl,
          async close () {
            stop()
            await rm(userDataDir, { recursive: true, force: true })
          },
        }
      }
      last = `status ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  stop()
  await rm(userDataDir, { recursive: true, force: true })
  throw new Error(`debugging port ${port} did not answer /json/version (${last})\n${chromeLog}`)
}

function bridge (wsUrl) {
  return async () => {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('browser websocket failed')), { once: true })
    })
    const queued = []
    let onmessage = null
    let onclose = null
    const conn = {
      send (message) { ws.send(message) },
      close () { ws.close() },
      get onmessage () { return onmessage },
      set onmessage (handler) {
        onmessage = handler
        if (!handler) return
        for (const message of queued.splice(0)) handler(message)
      },
      get onclose () { return onclose },
      set onclose (handler) { onclose = handler },
    }
    ws.addEventListener('message', event => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
      if (conn.onmessage) conn.onmessage(text)
      else queued.push(text)
    })
    ws.addEventListener('close', () => { conn.onclose?.('browser socket closed') })
    return conn
  }
}

async function sliccCdpDir () {
  const packed = path.join(tmpdir(), 'wasi-gh-auth')
  const dir = path.join(packed, 'package')
  try {
    await readFile(path.join(dir, 'bin/playwright-cli.wasm'))
    return dir
  } catch {
    await mkdir(packed, { recursive: true })
    const names = (await readdir(packed)).filter(name => name.endsWith('.tgz'))
    if (!names.length) {
      await new Promise((resolve, reject) => {
        const child = spawn('npm', ['pack', '@ai-ecoverse/slicc-cdp', '--pack-destination', packed], { stdio: 'inherit' })
        child.on('error', reject)
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`npm pack exited ${code}`)))
      })
    }
    const tarballs = (await readdir(packed)).filter(name => name.endsWith('.tgz'))
    if (!tarballs.length) throw new Error('npm pack produced no tarball')
    await new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', path.join(packed, tarballs[0]), '-C', packed], { stdio: 'inherit' })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)))
    })
    return dir
  }
}

async function installTree (kernel, name, base) {
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    const data = await readFile(file)
    const rel = path.relative(base, file)
    await kernel.writeFile(`/node_modules/@ai-ecoverse/${name}/${rel}`, data)
  }
}

async function targets (port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`json/list status ${response.status}`)
  return response.json()
}

const ghEnv = {
  HOME: '/home/app',
  GH_CONFIG_DIR: '/home/app/.config/gh',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_BROWSER: 'playwright-cli open',
}

const chrome = await launchChrome()
console.log(`chrome debugging ${chrome.wsUrl}`)
const kernel = await createNodeKernel({
  network: { transport: nodeTransport() },
  cdp: bridge(chrome.wsUrl),
})
let failed = false
try {
  await installTree(kernel, 'wasi-gh', ghPackage)
  await installTree(kernel, 'slicc-cdp', await sliccCdpDir())
  await kernel.writeFile('/home/app/.keep', '')

  const smoke = await kernel.run(['playwright-cli', 'open', 'https://example.com'], { cwd: '/home/app', env: ghEnv })
  process.stdout.write(redact(`smoke status ${smoke.status}\n${smoke.stdout}${smoke.stderr}`))
  const pages = await targets(chrome.port)
  const example = pages.find(page => String(page.url).includes('example.com'))
  if (smoke.status !== 0 || !example) {
    console.error('smoke failed: example.com tab did not open')
    failed = true
  } else {
    console.log(`smoke tab ${example.url}`)
    console.log('login: complete the GitHub device page in the Chrome window')
    const login = await kernel.run(
      ['gh', 'auth', 'login', '-w', '-p', 'https', '-c'],
      {
        cwd: '/home/app',
        env: ghEnv,
        stdin: 'y\n'.repeat(8),
        onStderr: text => process.stderr.write(redact(text)),
        onStdout: text => process.stdout.write(redact(text)),
      },
    )
    console.log(`login status ${login.status}`)
    if (login.status !== 0) {
      failed = true
    } else {
      const hosts = new TextDecoder().decode(await kernel.readFile('/home/app/.config/gh/hosts.yml'))
      const user = hosts.match(/^ {4}user:\s*(\S+)/m)?.[1] ?? ''
      const token = hosts.match(/oauth_token:\s*(\S+)/)?.[1] ?? ''
      console.log(`stored user ${user || '(missing)'} token_bytes ${token.length}`)
      const who = await kernel.run(['gh', 'api', 'user', '--jq', '.login'], { cwd: '/home/app', env: ghEnv })
      process.stdout.write(redact(who.stdout))
      process.stderr.write(redact(who.stderr))
      if (who.status !== 0 || !who.stdout.trim()) failed = true
      else console.log(`api user ok status ${who.status}`)
    }
  }
} finally {
  kernel.terminate()
  await chrome.close()
}
if (failed) process.exit(1)
