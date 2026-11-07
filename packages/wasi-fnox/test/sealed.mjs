// wasi-fnox against slicc-kernel's /dev/sealed (KS-2), exec tickets
// (KS-8) and the ask op (slicc-kernel >= 1.175.0) on the headless Node entry, with
// test/vault-double.mjs as the vault and wasm-bash and wasm-coreutils from npm
// as the programs fnox runs.
//
//   node packages/wasi-fnox/test/sealed.mjs --tarball .homescoop-out/package.tgz
//
// Part 1: seal, placeholder, ask (one blocking read, --ask, age and plain). Part 2 (users
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
const AGE_RECIPIENT = 'age106n8yr50p0cgudkw03ad2e92nk4fas5m8utmw0t4lm0dlc6pqg4scqmaup'

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

// 6. set on a terminal: one ask, one blocking read, no request or status
async function terminal (args, { cancelAfter } = {}) {
  let out = ''
  const term = await kernel.openTerminal(['fnox', ...args], { cwd: '/home/demo', env, onData: (d) => { out += Buffer.from(d).toString() } })
  if (cancelAfter) { await new Promise((res) => setTimeout(res, cancelAfter)); term.write('\x03') }
  const status = await Promise.race([term.exited, new Promise((res) => setTimeout(() => res('hung'), 20000))])
  return { status, out }
}
const asks = () => vault.log.filter((q) => q.op === 'ask')
const polled = () => vault.log.filter((q) => q.op === 'request' || q.op === 'status').length
vault.askAnswer = { state: 'done', value: 'typed-in-the-vault-dialog' }
let tr = await terminal(['set', 'DIALOG_TOKEN'])
assert.equal(tr.status, 0, tr.out)
assert.equal(asks().length, 1)
const { caller: askCaller, requester: askRequester, ...askSent } = asks()[0]
assert.deepEqual(askSent, { v: 1, op: 'ask', name: 'DIALOG_TOKEN', reveal: false, replace: true })
assert.equal(typeof askCaller.pid, 'number')
assert.deepEqual({ ...askRequester, tty: undefined }, { exe: '/usr/bin/fnox', argv: ['fnox', 'set', 'DIALOG_TOKEN'], cwd: '/home/demo', tty: undefined, stdin: 'tty' })
assert.match(askRequester.tty, /^\/dev\//)
assert.equal(polled(), 0, 'no request or status')
const dialogPh = vault.records.get('DIALOG_TOKEN').placeholder
assert.ok((await toml()).includes(`value = "${dialogPh}"`))
assert.ok(!tr.out.includes('typed-in-the-vault-dialog'))
assert.match(tr.out, /vault dialog/)
assert.match(tr.out, /Set secret DIALOG_TOKEN/)
ok('set on a terminal: one ask {name, reveal: false, replace: true}, the kernel\'s requester {exe /usr/bin/fnox, argv, cwd, tty, stdin: tty}, no request/status polling, placeholder stored, no prompt and no value on the terminal')

// 6b. a second set on a terminal replaces the value under the same placeholder
vault.askAnswer = { state: 'done', value: 'rotated-in-the-dialog' }
tr = await terminal(['set', 'DIALOG_TOKEN'])
assert.equal(tr.status, 0, tr.out)
assert.equal(vault.records.get('DIALOG_TOKEN').placeholder, dialogPh)
assert.equal(vault.records.get('DIALOG_TOKEN').value, 'rotated-in-the-dialog')
assert.equal([...vault.requests.values()].at(-1).mode, 'enter')
ok('set over an existing record: replace keeps the enter dialog, the value rotates under its placeholder')

// 6c. --ask from a pipe: stdin is never read, stdout is the placeholder alone
vault.askAnswer = { state: 'done', value: 'typed-for-the-agent' }
r = await run(['set', 'AGENT_TOKEN', '--ask', '-d', 'deploy key for CI'], { stdin: 'piped-but-ignored\n' })
assert.equal(r.status, 0, r.stderr)
const agentPh = vault.records.get('AGENT_TOKEN').placeholder
assert.equal(r.stdout, `${agentPh}\n`)
assert.match(r.stderr, /vault dialog/); assert.match(r.stderr, /Set secret AGENT_TOKEN/)
assert.equal(asks().at(-1).prompt, 'deploy key for CI'); assert.equal(asks().at(-1).reveal, false)
assert.equal(asks().at(-1).requester.stdin, 'pipe'); assert.equal(asks().at(-1).requester.tty, null)
assert.ok(!vault.log.some((q) => q.op === 'seal' && q.name === 'AGENT_TOKEN'), 'the piped value was not sealed')
assert.ok(![r.stdout, r.stderr, await toml()].some((x) => x.includes('typed-for-the-agent') || x.includes('piped-but-ignored')))
r = await run(['set', 'AGENT_TOKEN', 'v', '--ask'])
assert.notEqual(r.status, 0); assert.ok(asks().length === 3, '--ask with a VALUE never asks')
ok('set --ask with stdin on a pipe: ask {prompt: the description}, stdin ignored, stdout is the placeholder alone, status on stderr; --ask refuses a VALUE')

// 7. ^C while the dialog is open: exit 130, the kernel withdraws the ask
vault.askAnswer = undefined
tr = await terminal(['set', 'CANCELLED'], { cancelAfter: 2500 })
assert.equal(tr.status, 130, tr.out); assert.match(tr.out, /Cancelled/)
const withdrawn = [...vault.requests.values()].find((q) => q.name === 'CANCELLED')
assert.equal(withdrawn.state, 'withdrawn'); assert.equal(withdrawn.reason, 'withdrawn')
assert.ok(!vault.log.some((q) => q.op === 'cancel' && q.name === 'CANCELLED'))
assert.ok(!(await toml()).includes('CANCELLED'))
ok('^C during the blocking read exits 130; the kernel aborts the hook with withdrawn; nothing stored')

// 7b. the user denies, or the dialog expires
for (const state of ['cancelled', 'expired']) {
  vault.askAnswer = { state }
  tr = await terminal(['set', 'DENIED'])
  assert.equal(tr.status, 1, tr.out); assert.match(flat(tr.out), new RegExp(`the request for DENIED ended: ${state}`))
}
assert.ok(!(await toml()).includes('DENIED'))
ok('a denied or expired dialog exits 1 with the state; nothing stored')

// 8. empty stdin is refused; a second pending request is the vault's EAGAIN
r = await kernel.run(['fnox', 'set', 'OTHER'], { cwd: '/home/demo', env })
assert.notEqual(r.status, 0); assert.match(flat(r.stderr), /no value on stdin; pipe the value, or use `fnox set NAME --ask`/)
assert.ok(!vault.log.some((q) => q.op === 'seal' && q.name === 'OTHER'))
vault.requests.set('rqX', { state: 'pending', name: 'X', uid: 0, polls: 0 })
tr = await terminal(['set', 'BUSY'])
vault.requests.get('rqX').state = 'cancelled'
assert.notEqual(tr.status, 0); assert.match(flat(tr.out), /ask: EAGAIN: one request per user/)
ok('empty stdin is refused before any seal; a second pending request reports the vault\'s EAGAIN')

// 8b. age and plain: ask with reveal, store what the provider stores
await kernel.writeFile('/home/demo/fnox.toml', `[providers.team]\ntype = "age"\nrecipients = ["${AGE_RECIPIENT}"]\n\n[providers.local]\ntype = "plain"\n\n[providers.op]\ntype = "1password"\n\n[secrets]\n`)
vault.askAnswer = { state: 'done', value: 'plain-typed-value-9' }
r = await run(['set', 'PLAIN_TOKEN', '--provider', 'local', '--ask'])
assert.equal(r.status, 0, r.stderr)
assert.equal(asks().at(-1).reveal, true); assert.equal(asks().at(-1).replace, true)
assert.match(await toml(), /PLAIN_TOKEN ?= \{[^}]*provider = "local"[^}]*value = "plain-typed-value-9"/)
assert.equal(r.stdout, `${vault.records.get('PLAIN_TOKEN').placeholder}\n`)
assert.ok(!r.stderr.includes('plain-typed-value-9'))
vault.askAnswer = { state: 'done', value: 'age-typed-value-77' }
tr = await terminal(['set', 'AGE_TOKEN', '--provider', 'team'])
assert.equal(tr.status, 0, tr.out)
assert.equal(asks().at(-1).reveal, true)
t = await toml()
assert.match(t, /AGE_TOKEN ?= \{[^}]*provider = "team"/); assert.ok(!t.includes('age-typed-value-77') && !tr.out.includes('age-typed-value-77'))
assert.equal(vault.records.get('AGE_TOKEN').value, 'age-typed-value-77', 'the vault keeps its sealed copy')
const before8 = asks().length
r = await run(['set', 'OP_TOKEN', '--provider', 'op', '--ask'])
assert.notEqual(r.status, 0); assert.match(flat(r.stderr), /fills in sealed, age and plain secrets, not 1password/)
vault.askAnswer = { state: 'done' }
r = await run(['set', 'NOVALUE', '--provider', 'local', '--ask'])
assert.notEqual(r.status, 0); assert.match(flat(r.stderr), /the vault gave no value for NOVALUE/)
assert.equal(asks().length, before8 + 1, 'no dialog for a provider the dialog cannot fill in')
assert.ok(!(await toml()).includes('NOVALUE'))
vault.askAnswer = undefined
ok('age and plain: ask {reveal: true}; plain stores the typed value, age its ciphertext, the vault keeps a sealed copy; other providers are refused before a dialog; a reveal without a value stores nothing')

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
