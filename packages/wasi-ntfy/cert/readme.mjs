export default async function (ctx) {
  const { assert, read } = ctx
  const readme = await read('node_modules/@ai-ecoverse/wasi-ntfy/README.md')
  assert.ok(readme, 'README.md is installed')
  assert.match(readme, /The command runs as the user who started `ntfy sub`, with that user's\nprivileges/)
  assert.match(readme, /Treat everything in a message \(`NTFY_\*`\)\nas untrusted input/)
}
