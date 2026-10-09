/**
 * Cert-context helpers for packages/<name>/cert/*.mjs under slicc-kernel CDP.
 * @typedef {object} CertContext
 * @property {string} packageName homescoop recipe dir
 * @property {string} npmName
 * @property {(argv: string[], opts?: {cwd?: string, env?: Record<string,string>, stdin?: string|Uint8Array}) => Promise<{status:number,stdout:string,stderr:string}>} run
 * @property {(path: string, data: string|Uint8Array) => Promise<void>} write
 * @property {(path: string) => Promise<string|null>} read
 * @property {typeof import('node:assert/strict')} assert
 * @property {(responder: (req: {url:string, method:string, headers:[string,string][], body:Uint8Array}) => ({status?:number, statusText?:string, headers?:[string,string][], body?:string|Uint8Array}|Promise<object>)) => Promise<void>} serve
 *   Install the far end of the network: every request a program makes
 *   through the kernel's proxy (http and https alike) reaches `responder`.
 *   It runs in the page, so it must be self-contained (no closures).
 * @property {{ errors: string[] }} page
 */

import assert from 'node:assert/strict';

/**
 * @param {object} page harness page
 * @param {{ packageName: string, npmName: string }} meta
 * @returns {CertContext}
 */
export function makeContext(page, meta) {
  return {
    packageName: meta.packageName,
    npmName: meta.npmName,
    assert,
    page,
    async run(argv, opts = {}) {
      return page.evaluate(
        (a, o) => window.kernel.run(a, o),
        argv,
        {
          cwd: opts.cwd || '/home',
          env: opts.env || {},
          stdin: opts.stdin,
        },
      );
    },
    async write(path, data) {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('binary');
      await page.evaluate((p, t) => window.opfs.write(p, t), path.replace(/^\//, ''), text);
    },
    async serve(responder) {
      await page.evaluate((src) => {
        window.certNet = new Function(`return (${src})`)();
      }, responder.toString());
    },
    async read(path) {
      return page.evaluate((p) => window.opfs.read(p), path.replace(/^\//, ''));
    },
  };
}
