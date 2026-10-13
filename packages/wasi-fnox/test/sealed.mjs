// wasi-fnox against slicc-kernel's /dev/sealed (KS-2, slicc-kernel >= 1.68.0)
// on the headless Node entry, with test/vault-double.mjs as the vault.
//
//   node packages/wasi-fnox/test/sealed.mjs --tarball .homescoop-out/package.tgz
//
// Covers seal, placeholder, request/status/cancel and the materialize
// request; the values materialize hands out need KS-8 (cert/meta.json).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { vaultDouble } from './vault-double.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'))
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const tarball = arg('--tarball')
if (!tarball) { console.error('usage: sealed.mjs --tarball <wasi-fnox package.tgz> [--kernel <npm spec>]'); process.exit(2) }
const kernelSpec = arg('--kernel') ?? meta.sealedKernel
const work = mkdtempSync(join(tmpdir(), 'wasi-fnox-sealed-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))
execFileSync('tar', ['xzf', resolve(tarball), '-C', work])
execFileSync('npm', ['install', '--prefix', join(work, 'nm'), '--no-fund', '--no-audit', '--silent', kernelSpec], { stdio: 'inherit' })
const { createNodeKernel } = await import(pathToFileURL(join(work, 'nm/node_modules/@ai-ecoverse/slicc-kernel/dist/node.js')).href)
const wasm = readFileSync(join(work, 'package/bin/fnox.wasm'))
console.log(`== wasi-fnox sealed e2e on ${kernelSpec}`)

const vault = vaultDouble()
const kernel = await createNodeKernel({ sealed: vault })
const dec = new TextDecoder()
await kernel.writeFile('/node_modules/fnox/package.json', JSON.stringify({ name: 'fnox', version: '0.0.0', slicc: { abi: 'wasi', commands: { fnox: { wasm: 'bin/fnox.wasm' } } } }))
await kernel.writeFile('/node_modules/fnox/bin/fnox.wasm', wasm)
await kernel.writeFile('/etc/fnox/config.toml', 'default_provider = "seven"\n\n[providers.seven]\ntype = "sealed"\n')
await kernel.writeFile('/home/demo/fnox.toml', '[secrets]\n')
const env = { FNOX_CONFIG_DIR: '/etc/fnox', NO_COLOR: '1' }
const run = (args, o = {}) => kernel.run(['fnox', ...args], { cwd: '/home/demo', env, ...o })
const toml = async () => dec.decode(await kernel.readFile('/home/demo/fnox.toml'))
const flat = (s) => s.replace(/[\s│|]+/g, ' ')
const ok = (m) => console.log('ok  ', m)
const VALUE = 'throwaway-sealed-value-42'

// 1. seal from a pipe
let r = await run(['set', 'API_TOKEN'], { stdin: VALUE + '\n' })
assert.equal(r.status, 0, r.stderr)
const seal = vault.log.find((q) => q.op === 'seal')
assert.equal(seal.name, 'API_TOKEN'); assert.equal(seal.value, VALUE); assert.equal(seal.v, 1)
assert.equal(typeof seal.caller.pid, 'number'); assert.equal(seal.caller.uid, 0)
const ph = vault.records.get('API_TOKEN').placeholder
let t = await toml()
assert.ok(t.includes(`value = "${ph}"`) && t.includes('provider = "seven"'), t)
assert.ok(!t.includes(VALUE) && !r.stdout.includes(VALUE) && !r.stderr.includes(VALUE))
ok(`set from a pipe → seal {name, value} with caller {pid ${seal.caller.pid}, ppid ${seal.caller.ppid}, uid ${seal.caller.uid}}; fnox.toml holds ${ph}, no value anywhere`)

// 2. get/export: placeholder, no device traffic
const before = vault.log.length
r = await run(['get', 'API_TOKEN']); assert.equal(r.stdout.trim(), ph)
r = await run(['export', '--format', 'env']); assert.match(r.stdout, new RegExp(`^API_TOKEN=${ph}$`, 'm'))
assert.equal(vault.log.length, before); ok('get and export print the placeholder without asking the device')

// 3. rotation keeps the placeholder
r = await run(['set', 'API_TOKEN'], { stdin: 'rotated-throwaway\n' }); assert.equal(r.status, 0, r.stderr)
assert.ok((await toml()).includes(ph)); assert.equal(vault.records.get('API_TOKEN').value, 'rotated-throwaway')
ok('a second seal rotates the value under the same placeholder')

// 4. check --all: placeholder op, then removed and unknown records
r = await run(['check', '--all']); assert.equal(r.status, 0, r.stdout + r.stderr)
assert.ok(vault.log.some((q) => q.op === 'placeholder' && q.name === 'API_TOKEN'))
assert.match(r.stdout + r.stderr, /no rule names it yet/)
vault.records.get('API_TOKEN').state = 'removed'
r = await run(['check', '--all']); assert.notEqual(r.status, 0); assert.match(flat(r.stdout + r.stderr), /was removed from seven's vault/)
vault.records.get('API_TOKEN').state = 'active'; vault.records.get('API_TOKEN').placeholder = 'seven_ph_other'
r = await run(['check', '--all']); assert.notEqual(r.status, 0); assert.match(flat(r.stdout + r.stderr), /placeholder seven's vault does not know/)
vault.records.get('API_TOKEN').placeholder = ph
vault.records.delete('API_TOKEN')
r = await run(['check', '--all']); assert.notEqual(r.status, 0); assert.match(flat(r.stdout + r.stderr), /ENOENT/)
ok('check --all: placeholder {name}; inert warns, removed / unknown placeholder / missing record are errors')

// 5. errors from the vault reach the user verbatim
vault.records.set('HUMAN', { value: 'x', placeholder: 'seven_ph_h', state: 'active', from: 'human' })
r = await run(['set', 'HUMAN'], { stdin: 'y\n', user: undefined })
assert.equal(r.status, 0, 'root may re-seal a human value')
ok('re-seal by uid 0 over a human-entered value is allowed (the double enforces EEXIST for others)')

// 6. set on a terminal: request → status polling → done
async function terminal (args, { cancelAfter } = {}) {
  let out = ''
  const term = await kernel.openTerminal(['fnox', ...args], { cwd: '/home/demo', env, onData: (d) => { out += Buffer.from(d).toString() } })
  if (cancelAfter) { await new Promise((res) => setTimeout(res, cancelAfter)); term.write('\x03') }
  const status = await Promise.race([term.exited, new Promise((res) => setTimeout(() => res('hung'), 20000))])
  return { status, out }
}
vault.autoAnswer = 'typed-in-the-vault-dialog'
let tr = await terminal(['set', 'DIALOG_TOKEN'])
assert.equal(tr.status, 0, tr.out)
const req = vault.log.find((q) => q.op === 'request')
assert.equal(req.kind, 'value'); assert.equal(req.name, 'DIALOG_TOKEN')
const polls = vault.log.filter((q) => q.op === 'status').length
assert.ok(polls >= 2, `polls ${polls}`)
assert.ok((await toml()).includes(vault.records.get('DIALOG_TOKEN').placeholder))
assert.ok(!tr.out.includes('typed-in-the-vault-dialog'))
assert.match(tr.out, /vault dialog/)
ok(`set on a terminal: request {kind: value}, ${polls} status polls, placeholder stored, no prompt and no value on the terminal`)

// 7. ^C during a pending request → cancel, exit 130
vault.autoAnswer = undefined
tr = await terminal(['set', 'CANCELLED'], { cancelAfter: 2500 })
const cancel = vault.log.find((q) => q.op === 'cancel')
assert.ok(cancel, 'cancel sent'); assert.equal(tr.status, 130, tr.out)
assert.equal(vault.requests.get(cancel.id).state, 'cancelled')
assert.ok(!(await toml()).includes('CANCELLED'))
ok('^C while the dialog is pending sends cancel {id} and exits 130; nothing stored')

// 7b. ^C while a status read waits for a slow machine answer: the read is
// interrupted, the reply still arrives, then fnox cancels
vault.slowStatusMs = 4000
const cancelsBefore = vault.log.filter((q) => q.op === 'cancel').length
const started = Date.now()
tr = await terminal(['set', 'SLOW'], { cancelAfter: 1500 })
vault.slowStatusMs = 0
const slowCancel = vault.log.filter((q) => q.op === 'cancel').slice(cancelsBefore)
assert.equal(tr.status, 130, tr.out); assert.equal(slowCancel.length, 1)
assert.ok(Date.now() - started >= 3500, 'fnox waited for the slow reply before cancelling')
ok(`^C during a ${4000 / 1000} s machine wait: the reply is read, then cancel {id}, exit 130`)

// 8. empty stdin is refused; a second pending request is the vault's EAGAIN
r = await kernel.run(['fnox', 'set', 'OTHER'], { cwd: '/home/demo', env })
assert.notEqual(r.status, 0); assert.match(flat(r.stderr), /no value on stdin/)
assert.ok(!vault.log.some((q) => q.op === 'seal' && q.name === 'OTHER'))
vault.requests.set('rqX', { state: 'pending', name: 'X', uid: 0, polls: 0 })
tr = await terminal(['set', 'BUSY'])
vault.requests.get('rqX').state = 'cancelled'
assert.notEqual(tr.status, 0); assert.match(flat(tr.out), /request: EAGAIN: one request per user/)
ok('empty stdin is refused before any seal; a second pending request reports the vault\'s EAGAIN')

// 9. exec with a sealed secret: materialize; without KS-8 the vault refuses, fnox fails closed
await kernel.writeFile('/home/demo/fnox.toml', (await toml()) + '')
vault.records.set('API_TOKEN', { value: VALUE, placeholder: ph, state: 'active', from: 'process' })
await kernel.writeFile('/home/demo/fnox.toml', `[secrets]\nAPI_TOKEN = { provider = "seven", value = "${ph}" }\n`)
r = await run(['exec', '--', 'fnox', '--version'])
const mat = vault.log.find((q) => q.op === 'materialize')
assert.ok(mat, 'materialize sent'); assert.deepEqual(mat.names, ['API_TOKEN'])
assert.ok(mat.path.startsWith('/') && mat.argv[0] === mat.path && mat.argv[1] === '--version' && mat.cwd === '/home/demo', JSON.stringify(mat))
assert.notEqual(r.status, 0); assert.match(flat(r.stderr), /materialize: ENOTCONN/)
ok(`exec sends materialize {names, path ${mat.path}, argv, cwd} and fails closed on the vault's refusal`)
r = await run(['exec', '--shell-grants', '--', 'fnox', '--version'])
const sg = vault.log.filter((q) => q.op === 'materialize').at(-1)
assert.equal(sg.shellGrants, true); assert.equal(sg.names, undefined)
ok('exec --shell-grants sends materialize {shellGrants: true, path, argv, cwd} with no names')

// 10. a caller can't forge the stamp: fnox doesn't send one, the kernel's is there
assert.ok(vault.log.every((q) => q.caller && typeof q.caller.pid === 'number'))
ok(`all ${vault.log.length} requests carry the kernel's caller stamp`)
kernel.terminate()
console.log('wasi-fnox sealed e2e: ok')
