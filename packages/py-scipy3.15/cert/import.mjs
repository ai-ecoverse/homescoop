import { pyImport } from '../../../scripts/browser-cert/py-import.mjs';

export default async function (ctx) {
  await pyImport(ctx, { pkg: 'py-scipy', module: 'scipy', version: '1.18.1', minExt: 94, dist: 'scipy', skip: ['scipy.linalg._matfuncs_sqrtm_triu'] });
}
