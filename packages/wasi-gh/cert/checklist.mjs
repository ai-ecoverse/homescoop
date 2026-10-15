// Cert for @ai-ecoverse/wasi-gh. The far end is ctx.serve. No real GitHub
// and no real browser: GH_BROWSER is bash plus a script that records the
// URL it was given and whether a token was in its environment.

const TOKEN = 'sealed-placeholder'

// Runs in the page. Self-contained: do not close over helpers.
function responder (req) {
  const hdr = (name) => (req.headers.find(([key]) => key.toLowerCase() === name) || [])[1] || ''
  const url = new URL(req.url)
  const auth = hdr('authorization')
  const path = url.pathname
  if (url.hostname === 'github.com' && path === '/login/device/code') {
    return {
      headers: [['content-type', 'application/x-www-form-urlencoded']],
      body: 'device_code=cert-device&user_code=CERT-0000&verification_uri=https://github.com/login/device&interval=1&expires_in=300',
    }
  }
  if (url.hostname === 'github.com' && path === '/login/oauth/access_token') {
    return {
      headers: [['content-type', 'application/x-www-form-urlencoded']],
      body: 'access_token=cert-token&token_type=bearer&scope=repo%20read:org',
    }
  }
  if (url.hostname === 'api.github.com' && path === '/graphql') {
    return {
      headers: [['content-type', 'application/json']],
      body: '{"data":{"viewer":{"login":"octocat"}}}\n',
    }
  }
  if (url.hostname === 'api.github.com' && path === '/go') {
    return { status: 302, statusText: 'Found', headers: [['location', 'https://evil.example/land']], body: '' }
  }
  if (url.hostname === 'evil.example') {
    return { headers: [['content-type', 'text/plain']], body: auth === '' ? 'no-authorization\n' : `leaked ${auth}\n` }
  }
  if (url.hostname === 'api.github.com') {
    return { headers: [['content-type', 'text/plain']], body: `${auth}\n` }
  }
  return { status: 404, statusText: 'Not Found', headers: [['content-type', 'text/plain']], body: `nope ${url.href}\n` }
}

export default async function (ctx) {
  const { run, serve, write, read, assert } = ctx
  const home = '/home/gh'
  const base = {
    HOME: home,
    GH_CONFIG_DIR: `${home}/.config/gh`,
    GH_NO_UPDATE_NOTIFIER: '1',
  }
  const env = { ...base, GH_TOKEN: TOKEN }
  await serve(responder)
  const made = await run(['bash', '-c', `mkdir -p ${home}/repo`], { cwd: '/home' })
  assert.equal(made.status, 0, made.stderr)

  const version = await run(['gh', 'version'], { cwd: home, env })
  assert.equal(version.status, 0, version.stderr)
  assert.match(version.stdout, /^gh version 2\.102\.0 \(2026-09-29\)\n/)

  const api = await run(['gh', 'api', 'https://api.github.com/user'], { cwd: home, env })
  assert.equal(api.status, 0, `${api.stderr}${api.stdout}`)
  assert.equal(api.stdout, `token ${TOKEN}\n`)

  const redirected = await run(['gh', 'api', 'https://api.github.com/go'], { cwd: home, env })
  assert.equal(redirected.status, 0, `${redirected.stderr}${redirected.stdout}`)
  assert.equal(redirected.stdout, 'no-authorization\n')

  // $1 is the file the script writes. gh appends the URL as the next argument.
  await write(
    `${home}/record.sh`,
    [
      'out=$1',
      'shift',
      'printf \'%s\\n\' "$@" > "$out"',
      'printf \'GH_TOKEN=%s\\n\' "${GH_TOKEN-unset}" >> "$out"',
      'printf \'GITHUB_TOKEN=%s\\n\' "${GITHUB_TOKEN-unset}" >> "$out"',
      '',
    ].join('\n'),
  )
  const login = await run(
    ['gh', 'auth', 'login', '-w', '-p', 'https'],
    {
      cwd: home,
      env: { ...base, GH_BROWSER: `bash ${home}/record.sh ${home}/opened` },
      stdin: 'y\n',
    },
  )
  assert.equal(login.status, 0, `${login.stderr}${login.stdout}`)
  assert.match(login.stderr, /Logged in as octocat/)
  assert.equal(
    await read(`${home}/opened`),
    'https://github.com/login/device\nGH_TOKEN=unset\nGITHUB_TOKEN=unset\n',
  )

  const id = await run(['id', '-u'], { cwd: home, env: base })
  assert.equal(id.status, 0, id.stderr)
  const uid = id.stdout.trim()
  const modes = await run(
    ['stat', '-c', '%a %u %n', `${home}/.config/gh`, `${home}/.config/gh/hosts.yml`],
    { cwd: home, env: base },
  )
  assert.equal(modes.status, 0, modes.stderr)
  assert.equal(
    modes.stdout,
    `700 ${uid} ${home}/.config/gh\n600 ${uid} ${home}/.config/gh/hosts.yml\n`,
  )

  const gitEnv = { ...env, GIT_AUTHOR_NAME: 'cert', GIT_AUTHOR_EMAIL: 'cert@example.invalid' }
  let git = await run(['git', 'init', '-q', '-b', 'main'], { cwd: `${home}/repo`, env: gitEnv })
  assert.equal(git.status, 0, git.stderr)
  git = await run(
    ['git', 'remote', 'add', 'origin', 'https://github.com/cli/cli.git'],
    { cwd: `${home}/repo`, env: gitEnv },
  )
  assert.equal(git.status, 0, git.stderr)
  const view = await run(['gh', 'repo', 'set-default', '--view'], { cwd: `${home}/repo`, env })
  assert.equal(view.status, 0, `${view.stderr}${view.stdout}`)
  assert.match(view.stderr, /No default remote repository has been set/)

  // The parent has both token variables. The browser command must not.
  const browse = await run(
    ['gh', 'browse'],
    {
      cwd: `${home}/repo`,
      env: { ...env, GITHUB_TOKEN: TOKEN, GH_BROWSER: `bash ${home}/record.sh ${home}/browsed` },
    },
  )
  assert.equal(browse.status, 0, `${browse.stderr}${browse.stdout}`)
  const browsed = await read(`${home}/browsed`)
  assert.match(browsed, /^https:\/\/github\.com\/cli\/cli\nGH_TOKEN=unset\nGITHUB_TOKEN=unset\n/)
}
