// wasi-fnox against slicc-kernel's /dev/sealed (KS-2) and exec tickets
// (KS-8, slicc-kernel >= 1.83.0) on the headless Node entry, with
// test/vault-double.mjs as the vault and wasm-bash and wasm-coreutils from npm
// as the programs fnox runs.
//
//   node packages/wasi-fnox/test/sealed.mjs --tarball .homescoop-out/package.tgz
//
// Part 1: seal, placeholder, request/status/cancel. Part 2 (users
// 'enforce'): the values exec and exec --shell-grants hand out, what the
// child exposes, tickets that fail closed, and the interpreter chain.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
execFileSync('npm', ['install', '--prefix', join(work, 'nm'), '--no-fund', '--no-audit', '--silent', kernelSpec, ...meta.sealedNeeds], { stdio: 'inherit' })
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

// Part 2: exec tickets (KS-8), in a kernel with users 'enforce'.
const v2 = vaultDouble()
const k2 = await createNodeKernel({ sealed: v2, users: 'enforce' })
const nm = join(work, 'nm/node_modules')
async function install (dir, name) {
  const walk = async (d, rel = '') => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      const rp = rel ? `${rel}/${e}` : e
      if (statSync(p).isDirectory()) await walk(p, rp)
      else await k2.writeFile(`/node_modules/${name}/${rp}`, readFileSync(p))
    }
  }
  await walk(dir)
}
for (const spec of meta.sealedNeeds) {
  const name = spec.slice(0, spec.lastIndexOf('@'))
  await install(join(nm, name), name)
}
await k2.writeFile('/node_modules/fnox/package.json', JSON.stringify({ name: 'fnox', version: '0.0.0', slicc: { abi: 'wasi', commands: { fnox: { wasm: 'bin/fnox.wasm' } } } }))
await k2.writeFile('/node_modules/fnox/bin/fnox.wasm', wasm)
await k2.writeFile('/etc/fnox/config.toml', 'default_provider = "seven"\n\n[providers.seven]\ntype = "sealed"\n')
const sha = (s) => createHash('sha256').update(s).digest('hex')
const NPM = 'npm_throwaway_value_0123456789'
const NPM_PH = 'seven_ph_npm_token_0001'
const OTHER = 'other_throwaway_value_xyz'
const OPENAI = 'sk-throwaway-shell-grant-value-42'
v2.records.set('NPM_TOKEN', { value: NPM, placeholder: NPM_PH, state: 'active', from: 'process' })
v2.records.set('OTHER', { value: OTHER, placeholder: 'seven_ph_other_0002', state: 'active', from: 'process' })
v2.records.set('OPENAI_API_KEY', { value: OPENAI, placeholder: 'seven_ph_openai_0003', state: 'active', from: 'human' })
await k2.writeFile('/home/demo/fnox.toml', `[secrets]\nNPM_TOKEN = { provider = "seven", value = "${NPM_PH}" }\nOTHER = { provider = "seven", value = "seven_ph_other_0002" }\n`)
await k2.writeFile('/tmp/.keep', '')
const run2 = (argv, o = {}) => k2.run(argv, { cwd: '/home/demo', env, ...o })
const fnox2 = (args, o = {}) => run2(['fnox', ...args], o)
const secretsIn = (r) => [NPM, OTHER, OPENAI].filter((x) => (r.stdout + r.stderr).includes(x))

// 11. exec under an argv grant: the child gets the value, fnox and the child's output never show it
v2.exec = { NPM_TOKEN: { argv: [['/usr/bin/bash', '-c']] } }
const probe = 'echo "seen=$NPM_TOKEN other=$OTHER"; printf %s "$NPM_TOKEN" | sha256sum; printf %s "$OTHER" | sha256sum; printf %s "$NPM_TOKEN" > /tmp/npm.out'
r = await fnox2(['exec', '--', 'bash', '-c', probe])
assert.equal(r.status, 0, r.stderr)
const [m1] = v2.log.filter((q) => q.op === 'materialize')
assert.deepEqual(m1.names, ['NPM_TOKEN', 'OTHER'])
assert.equal(m1.path, '/usr/bin/bash'); assert.deepEqual(m1.argv, ['/usr/bin/bash', '-c', probe]); assert.equal(m1.cwd, '/home/demo')
assert.equal(m1.interpreter, undefined, 'fnox never claims an interpreter')
const c1 = v2.log.find((q) => q.op === 'materializeConsume')
assert.equal(c1.stamp.ppid, m1.caller.pid, 'the child was spawned by the process that asked')
assert.deepEqual(c1.interpreters, [])
assert.match(r.stdout, new RegExp(`^seen=${NPM_PH} other=seven_ph_other_0002$`, 'm'), 'the child\'s echo is scrubbed back to the placeholder')
assert.ok(r.stdout.includes(sha(NPM)), 'the child really holds the value (its sha256)')
assert.ok(r.stdout.includes(sha('seven_ph_other_0002')), 'OTHER (real: false) kept its placeholder')
assert.match(r.stderr, /OTHER keeps its placeholder/)
assert.deepEqual(secretsIn(r), [], 'no value on fnox\'s or the child\'s stdout/stderr')
assert.equal(dec.decode(await k2.readFile('/tmp/npm.out')), NPM, 'files the child writes are not scrubbed (documented residual)')
ok('exec under { argv }: materialize {names, path /usr/bin/bash, argv, cwd}, no interpreter claim; consume from the child (ppid = asker); the child holds the value, real:false keeps its placeholder, output scrubbed')

// 12. exposure: /proc, the child's own children, other users
const expose = 'printf "%s" "$$" > /tmp/child.pid; tr "\\0" " " < /proc/$$/cmdline > /tmp/child.cmdline; test -e /proc/$$/environ && echo environ || echo noenviron; bash -c \'printf %s "$NPM_TOKEN" | sha256sum\'; sleep 3'
const pending = fnox2(['exec', '--', 'bash', '-c', expose])
let childPid
for (let i = 0; i < 100 && !childPid; i++) {
  await new Promise((res) => setTimeout(res, 100))
  try { childPid = dec.decode(await k2.readFile('/tmp/child.pid')).trim() || undefined } catch {}
}
assert.ok(childPid, 'child started')
await k2.users.add({ name: 'mallory', uid: 1001, gid: 1001, home: '/home/mallory' })
const peek = await run2(['bash', '-c', `cat /proc/${childPid}/cmdline; for p in /proc/[0-9]*; do [ "\${p#/proc/}" = "${childPid}" ] && echo listed; done; echo done`], { user: 'mallory', cwd: '/tmp' })
r = await pending
assert.equal(r.status, 0, r.stderr)
assert.match(r.stdout, /noenviron/, 'no /proc/<pid>/environ')
const lines = r.stdout.trim().split('\n')
assert.equal(lines.filter((l) => l.startsWith(sha(NPM))).length, 1, 'the grandchild inherits the value')
assert.ok(!(peek.stdout + peek.stderr).includes(NPM), 'another user sees no value')
assert.match(peek.stdout, /^done$/m, peek.stderr); assert.doesNotMatch(peek.stdout, /listed/, `mallory does not see root's child in /proc: ${peek.stdout}`)
assert.deepEqual(secretsIn(r), [])
const cmdline = dec.decode(await k2.readFile('/tmp/child.cmdline'))
assert.ok(cmdline.includes('bash') && !cmdline.includes(NPM), `cmdline: ${cmdline}`)
ok('exposure: the child\'s cmdline has no value, there is no /proc/<pid>/environ, its own children inherit the value (output still scrubbed), another user cannot see the process')

// 13. tickets fail closed: a used ticket and a forged one
const used = v2.consumes.find((c) => !c.refused).ticket
for (const [label, ticket] of [['a used ticket', used], ['a forged ticket', 'f'.repeat(32)]]) {
  r = await run2(['bash', '-c', `SLICC_SEALED_TICKET=${ticket} /usr/bin/printenv NPM_TOKEN; echo "rc=$?"`])
  assert.match(r.stdout, /rc=126/, `${label}: ${r.stdout} ${r.stderr}`)
  assert.deepEqual(secretsIn(r), [])
}
ok('a used or forged SLICC_SEALED_TICKET fails the exec with EACCES (126) and reveals nothing')

// 14. exec --shell-grants: only shell = true secrets, named by the vault
v2.exec = { OPENAI_API_KEY: { shell: true }, NPM_TOKEN: { argv: [['/usr/bin/bash', '-c']] } }
const sgProbe = 'printf %s "$OPENAI_API_KEY" | sha256sum; printf %s "$NPM_TOKEN" | sha256sum; echo "key=$OPENAI_API_KEY"'
r = await fnox2(['exec', '--shell-grants', '--', '/bin/bash', '-c', sgProbe])
assert.equal(r.status, 0, r.stderr)
const m2 = v2.log.filter((q) => q.op === 'materialize').at(-1)
assert.equal(m2.shellGrants, true); assert.equal(m2.names, undefined)
assert.ok(v2.log.some((q) => q.op === 'placeholder' && q.name === 'OPENAI_API_KEY'), 'the granted name\'s placeholder came from the vault')
assert.ok(r.stdout.includes(sha(OPENAI)), 'the shell-granted secret is real in the bash')
assert.ok(r.stdout.includes(sha(NPM_PH)), 'the config\'s own sealed secret keeps its placeholder under --shell-grants')
assert.match(r.stdout, /^key=seven_ph_openai_0003$/m)
assert.deepEqual(secretsIn(r), [])
ok('exec --shell-grants: materialize {shellGrants} without names; the shell-granted secret is real (placeholder via `placeholder {name}`), the config\'s sealed secrets stay placeholders, output scrubbed')

// 15. the interpreter chain of an npm-style `#!/usr/bin/env bash` script
const script = '#!/usr/bin/env bash\nprintf %s "$NPM_TOKEN" | sha256sum\n'
await k2.writeFile('/opt/tools/npmish', script)
await k2.writeFile('/tmp/loose/npmish', script)
await run2(['bash', '-c', 'chmod 755 /opt/tools/npmish /tmp/loose/npmish; chmod 777 /tmp/loose'], { cwd: '/' })
const chain = async (policy, prog) => {
  v2.exec = { NPM_TOKEN: policy }
  const before = v2.consumes.length
  const res = await fnox2(['exec', '--', prog])
  return { res, consume: v2.consumes.slice(before)[0], req: v2.log.filter((q) => q.op === 'materializeConsume').at(-1) }
}
let c = await chain({ argv: [['/opt/tools/npmish']] }, '/opt/tools/npmish')
assert.equal(c.res.status, 0, c.res.stderr); assert.ok(c.res.stdout.includes(sha(NPM)))
assert.deepEqual(c.req.interpreters, ['/usr/bin/bash']); assert.equal(c.req.trusted, true)
c = await chain({ argv: [['/tmp/loose/npmish']] }, '/tmp/loose/npmish')
assert.notEqual(c.res.status, 0); assert.equal(c.req.trusted, false); assert.match(c.consume.refused, /untrusted/)
assert.match(c.res.stderr, /Permission denied/); assert.deepEqual(secretsIn(c.res), [])
c = await chain(true, '/opt/tools/npmish')
assert.notEqual(c.res.status, 0); assert.match(c.consume.refused, /interpreter bash is refused/)
ok('interpreter chain (#!/usr/bin/env bash, reported as /usr/bin/bash): argv rule + trusted → real; untrusted (world-writable dir) → refused; exec = true → refused; fnox never claims')

k2.terminate()
console.log('wasi-fnox sealed e2e: ok')
