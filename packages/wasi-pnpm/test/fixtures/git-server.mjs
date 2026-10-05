// A local git smart-HTTP server for wasi-pnpm's end-to-end tests:
// node:http in front of `git http-backend` (CGI) over bare repositories
// created on the fly, so CI needs only the system git.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd } }).toString().trim()

export function createRepo (root, name, files, { tag, branch } = {}) {
  const work = join(root, `${name}-work`)
  mkdirSync(work, { recursive: true })
  git(['init', '-q', '-b', 'main'], work)
  for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content)
  git(['add', '--', ...Object.keys(files)], work)
  git(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], work)
  if (tag) git(['tag', tag], work)
  if (branch) git(['branch', branch], work)
  const commit = git(['rev-parse', 'HEAD'], work)
  git(['clone', '-q', '--bare', work, join(root, `${name}.git`)], root)
  return { url: `${name}.git`, commit }
}

export async function startGitServer () {
  const root = mkdtempSync(join(tmpdir(), 'wasi-pnpm-git-'))
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method,
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
        REMOTE_ADDR: '127.0.0.1',
      },
    })
    req.pipe(child.stdin)
    let head = Buffer.alloc(0)
    let sent = false
    child.stdout.on('data', chunk => {
      if (sent) return res.write(chunk)
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) return
      const headers = {}
      let status = 200
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const at = line.indexOf(':')
        const name = line.slice(0, at).trim()
        const value = line.slice(at + 1).trim()
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10)
        else headers[name] = value
      }
      res.writeHead(status, headers)
      sent = true
      res.write(head.subarray(end + 4))
    })
    child.on('close', () => {
      if (!sent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/`
  return {
    root,
    base,
    repo: (name, files, options) => {
      const repo = createRepo(root, name, files, options)
      return { ...repo, url: base + repo.url }
    },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
