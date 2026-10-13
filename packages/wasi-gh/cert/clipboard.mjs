// Cert for the wasip1 clipboard shell-out. No real clipboard: xclip is a
// bash script on PATH. pbcopy is absent, so gh falls through to
// `xclip -in -selection clipboard`. A non-zero exit is not fatal.

const TOKEN = 'sealed-placeholder'

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
  const home = '/home/clip'
  const failBin = `${home}/fail`
  const okBin = `${home}/ok`
  const base = {
    HOME: home,
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_BROWSER: 'true',
  }
  await serve(responder)
  const made = await run(['bash', '-c', `mkdir -p ${failBin} ${okBin}`], { cwd: '/home' })
  assert.equal(made.status, 0, made.stderr)

  // The success script is bash only. gh's PATH in this spec is that
  // directory, so an external cat would not be there.
  await write(`${failBin}/xclip`, '#!/usr/bin/env bash\nexit 1\n')
  await write(
    `${okBin}/xclip`,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${home}/argv`,
      'data=$(</dev/stdin)',
      `printf '%s' "$data" > ${home}/copied`,
      '',
    ].join('\n'),
  )
  const mode = await run(['chmod', '755', `${failBin}/xclip`, `${okBin}/xclip`], { cwd: home, env: base })
  assert.equal(mode.status, 0, mode.stderr)

  const failed = await run(
    ['gh', 'auth', 'login', '-w', '-c', '-p', 'https'],
    {
      cwd: home,
      env: { ...base, GH_CONFIG_DIR: `${home}/.config/gh-fail`, PATH: failBin },
      stdin: 'y\n',
    },
  )
  assert.equal(failed.status, 0, `${failed.stderr}${failed.stdout}`)
  assert.match(failed.stderr, /Failed to copy one-time code to clipboard/)
  assert.match(failed.stderr, /clipboard unavailable/)
  assert.match(failed.stderr, /First copy your one-time code:.*CERT-0000/)
  assert.match(failed.stderr, /Logged in as octocat/)

  const ok = await run(
    ['gh', 'auth', 'login', '-w', '-c', '-p', 'https'],
    {
      cwd: home,
      env: { ...base, GH_CONFIG_DIR: `${home}/.config/gh-ok`, PATH: okBin },
      stdin: 'y\n',
    },
  )
  assert.equal(ok.status, 0, `${ok.stderr}${ok.stdout}`)
  assert.match(ok.stderr, /One-time code \(CERT-0000\) copied to clipboard/)
  assert.equal(await read(`${home}/copied`), 'CERT-0000')
  assert.equal(await read(`${home}/argv`), '-in\n-selection\nclipboard\n')
}
