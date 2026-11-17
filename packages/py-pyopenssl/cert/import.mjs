import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-pyopenssl', module: 'OpenSSL', version: '26.4.0', dist: 'pyOpenSSL' });
}
