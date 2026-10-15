// Last spec on purpose: it replaces the host module for the rest of the boot.
// gh.wasm imports gh_host, and a probe other than 0x67683131 is the missing
// module. The kernel reads this file again on the next launch.

const STUB = `export function createImports () {
  return { gh_host: { probe: () => 0, call: () => 0, take: () => {} } }
}
`

export default async function (ctx) {
  const { run, write, assert } = ctx
  await write('node_modules/@ai-ecoverse/wasi-gh/host/gh-host.mjs', STUB)
  const result = await run(
    ['gh', 'api', 'https://api.github.com/user'],
    {
      cwd: '/home/gh',
      env: {
        HOME: '/home/gh',
        GH_CONFIG_DIR: '/home/gh/.config/gh',
        GH_NO_UPDATE_NOTIFIER: '1',
        GH_TOKEN: 'sealed-placeholder',
      },
    },
  )
  assert.notEqual(result.status, 0)
  assert.match(
    `${result.stdout}${result.stderr}`,
    /needs slicc-kernel with @ai-ecoverse\/wasi-gh's host module/,
  )
}
