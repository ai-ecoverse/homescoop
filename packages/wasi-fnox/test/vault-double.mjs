// A /dev/sealed vault double for slicc-kernel's `sealed` hook
// (secrets-tokens-design.md §3.7): records and requests in memory, every
// request logged with the kernel's caller stamp. Fake values only.
//
// Exec tickets follow slicc-vault's README (Exec): set `hook.exec` to a policy
// such as { NAME: true | { argv: [[...]] } | { shell: true } }; without one,
// materialize answers ENOTCONN.
import { randomBytes } from 'node:crypto'

const REFUSED = /^(sh|bash|dash|zsh|fish|busybox|jsh|python.*|node|deno|bun|perl|ruby|php|lua|wasmer|awk|gawk|mawk|nawk|sed|tclsh|expect|R|Rscript|irb|env|printenv|xargs|sudo|su|nohup|timeout|time|nice|strace)$/
const base = (p) => p.split('/').pop()
const refused = (p) => REFUSED.test(base(p))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function vaultDouble () {
  const records = new Map()
  const requests = new Map()
  const tickets = new Map()
  const consumes = []
  const log = []
  let n = 0
  const err = (code, message) => ({ v: 1, error: { code, message } })
  const ph = (name) => `seven_ph_${name.toLowerCase()}_${String(++n).padStart(4, '0')}`
  const hook = async (req, { signal }) => {
    log.push(req)
    if (!req.caller || typeof req.caller.pid !== 'number') return err('EINVAL', 'no caller stamp')
    switch (req.op) {
      case 'seal': {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(req.name ?? '')) return err('EINVAL', 'bad name')
        if (typeof req.value !== 'string' || /[\r\n\0]/.test(req.value)) return err('EINVAL', 'bad value')
        const r = records.get(req.name)
        if (r) { if (r.from !== 'process' && req.caller.uid !== 0) return err('EEXIST', 'entered by the human'); r.value = req.value; return { v: 1, placeholder: r.placeholder, state: r.state } }
        const rec = { value: req.value, placeholder: ph(req.name), state: 'inert', from: 'process' }
        records.set(req.name, rec)
        return { v: 1, placeholder: rec.placeholder, state: rec.state }
      }
      case 'placeholder': {
        const r = records.get(req.name)
        return r ? { v: 1, placeholder: r.placeholder, state: r.state } : err('ENOENT', `no record ${req.name}`)
      }
      case 'list':
        return { v: 1, secrets: [...records].map(([name, r]) => ({ name, placeholder: r.placeholder, state: r.state, exec: false, rules: [] })) }
      case 'request': {
        if ([...requests.values()].some((q) => q.state === 'pending' && q.uid === req.caller.uid)) return err('EAGAIN', 'one request per user')
        const id = `rq${++n}`
        requests.set(id, { state: 'pending', name: req.name, uid: req.caller.uid, polls: 0 })
        return { v: 1, state: 'pending', id }
      }
      case 'status': {
        if (hook.slowStatusMs) await new Promise((res) => setTimeout(res, hook.slowStatusMs))
        const q = requests.get(req.id)
        if (!q) return err('ENOENT', 'no such request')
        if (q.state === 'pending' && hook.autoAnswer && ++q.polls >= 2) {
          const rec = { value: hook.autoAnswer, placeholder: ph(q.name), state: 'inert', from: 'human' }
          records.set(q.name, rec)
          q.state = 'done'; q.placeholder = rec.placeholder
        }
        return q.state === 'done' ? { v: 1, state: 'done', placeholder: q.placeholder, record: 'inert' } : { v: 1, state: q.state }
      }
      case 'cancel': {
        const q = requests.get(req.id)
        if (!q) return err('ENOENT', 'no such request')
        q.state = 'cancelled'
        return { v: 1, state: 'cancelled' }
      }
      case 'materialize': {
        if (!hook.exec) return err('ENOTCONN', 'no exec policy in this double')
        const names = [...(req.names ?? [])]
        if (req.shellGrants) for (const [name, mode] of Object.entries(hook.exec)) if (mode?.shell && !names.includes(name)) names.push(name)
        const real = {}
        for (const name of names) {
          if (!records.has(name)) return err('ENOENT', `no record ${name}`)
          const mode = hook.exec[name]
          if (mode === true) {
            if (refused(req.path)) return err('EACCES', `${name}: ${base(req.path)} is refused for exec`)
            real[name] = records.get(name).state !== 'removed'
          } else if (mode?.argv) {
            const cmd = [req.path, ...req.argv.slice(1)]
            real[name] = mode.argv.some((prefix) => same(cmd.slice(0, prefix.length), prefix))
          } else {
            real[name] = mode?.shell === true
          }
        }
        const ticket = randomBytes(16).toString('hex')
        tickets.set(ticket, { pid: req.caller.pid, path: req.path, argv: req.argv, cwd: req.cwd, real, at: Date.now() })
        return { v: 1, ticket, expiresAt: Date.now() + 30000, real }
      }
      case 'materializeConsume': {
        const t = tickets.get(req.ticket)
        tickets.delete(req.ticket)
        const refuse = (why) => { consumes.push({ ticket: req.ticket, refused: why }); return err('EACCES', `ticket refused: ${why}`) }
        if (!t) return refuse('unknown ticket')
        if (Date.now() - t.at > 30000) return refuse('expired')
        if (req.stamp?.ppid !== t.pid) return refuse('not the asking process')
        if (req.path !== t.path || !same(req.argv, t.argv) || req.cwd !== t.cwd) return refuse('program, argv or cwd differs')
        const values = {}
        const placeholders = {}
        for (const [name, isReal] of Object.entries(t.real)) {
          if (!isReal) continue
          const mode = hook.exec[name]
          const chain = req.interpreters ?? []
          if (mode === true && [req.resolved ?? req.path, ...chain].some(refused)) return refuse(`${name}: interpreter ${chain.map(base).join(', ')} is refused`)
          if (mode?.argv && chain.some(refused) && req.trusted !== true) return refuse(`${name}: untrusted interpreter chain`)
          values[name] = records.get(name).value
          placeholders[name] = records.get(name).placeholder
        }
        consumes.push({ ticket: req.ticket, names: Object.keys(values), interpreters: req.interpreters, trusted: req.trusted })
        return { v: 1, values, placeholders }
      }
      default:
        return err('EINVAL', 'unknown op')
    }
  }
  hook.records = records
  hook.requests = requests
  hook.log = log
  hook.tickets = tickets
  hook.consumes = consumes
  return hook
}
