export default async function ({ assert, stdout, version }) {
  const [maj, min] = version.split('.');
  assert.match(stdout, new RegExp(`^libiconv ${maj}\\.${Number(min)}$`, 'm'), '_libiconv_version is the recipe version');
}
