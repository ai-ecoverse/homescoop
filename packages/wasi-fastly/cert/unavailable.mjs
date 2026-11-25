// What the Fastly CLI for slicc refuses (0003): each command stops with its
// reason before it reaches the network or tries to start a program.
import { TOKEN, asUser, output, requests, stub } from './lib/stub.mjs'

export default async function (ctx) {
  const { assert, write } = ctx
  const fastly = await asUser(ctx, 'builder')
  await stub(ctx)
  await write('/home/builder/app/fastly.toml', 'manifest_version = 3\nname = "cert-app"\nlanguage = "rust"\nservice_id = "SU1Z0isxPaozGVKXdv0eY"\n')
  await write('/home/builder/app/recv.vcl', 'set req.http.X-Cert = "1";\n')
  const env = { FASTLY_API_TOKEN: TOKEN }
  for (const [argv, message] of [
    [['compute', 'build'], /building a Compute package is not available in the Fastly CLI for slicc: it runs the project's language toolchain/],
    [['compute', 'publish'], /building a Compute package is not available in the Fastly CLI for slicc/],
    [['compute', 'hash-files'], /building a Compute package is not available in the Fastly CLI for slicc/],
    [['compute', 'serve'], /'fastly compute serve' is not available in the Fastly CLI for slicc: it builds the package and runs it under Viceroy/],
    [['compute', 'init'], /'fastly compute init' is not available in the Fastly CLI for slicc/],
    [['compute', 'install-tools'], /'fastly compute install-tools' is not available in the Fastly CLI for slicc/],
    [['vcl', 'serve', 'recv.vcl'], /'fastly vcl serve' is not available in the Fastly CLI for slicc: it publishes the VCL to a Fiddle sandbox and then serves it on a local port/],
    [['update'], /'fastly update' is not available in the Fastly CLI for slicc/],
    [['install', '17.0.0'], /'fastly install' is not available in the Fastly CLI for slicc/],
    [['auth', 'login', '--sso', '--token', 'work'], /SSO is not available in the Fastly CLI for slicc: it waits for the browser to come back to http:\/\/localhost:8080\/callback/],
    [['profile', 'create', 'work', '--sso'], /SSO is not available in the Fastly CLI for slicc/],
  ]) {
    const result = await fastly(['fastly', ...argv], { cwd: '/home/builder/app', env })
    assert.equal(result.status, 1, `fastly ${argv.join(' ')}: ${output(result)}`)
    assert.match(output(result), message, `fastly ${argv.join(' ')}`)
    assert.doesNotMatch(output(result), /configured to collect data related to Wasm builds/, `fastly ${argv.join(' ')}`)
  }
  assert.deepEqual(await requests(ctx), [], 'the refused commands make no request')

  // The help of a refused command still works, and the error names the way out.
  const help = await fastly(['fastly', 'compute', 'build', '--help'], { cwd: '/home/builder/app' })
  assert.equal(help.status, 0, output(help))
  assert.match(output(help), /Build a Compute package locally/)
  const sso = await fastly(['fastly', 'auth', 'login', '--sso', '--token', 'work'])
  assert.match(output(sso), /set FASTLY_API_TOKEN, or store it with 'fastly auth add <name> --api-token <token>'/)
}
