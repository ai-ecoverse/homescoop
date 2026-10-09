/**
 * Cert-context helpers for packages/<name>/cert/*.mjs under slicc-kernel CDP.
 * @typedef {object} CertContext
 * @property {string} packageName homescoop recipe dir
 * @property {string} npmName
 * @property {(argv: string[], opts?: {cwd?: string, env?: Record<string,string>, stdin?: string|Uint8Array}) => Promise<{status:number,stdout:string,stderr:string}>} run
 * @property {(path: string, data: string|Uint8Array) => Promise<void>} write
 * @property {(path: string) => Promise<string|null>} read
 * @property {(cfg: {names?: Record<string,string[]>, peers?: Record<string, {http?: {status?: number, headers?: [string,string][], body?: string}, error?: string}>}) => Promise<void>} uplink
 *   (cert/meta.json "uplink": true) What the kernel's tailnet uplink answers: 100.64.0.0/10 routes to it.
 * @property {() => Promise<{asked: object[], dialled: object[], requests: object[]}>} uplinkLog
 * @property {typeof import('node:assert/strict')} assert
 * @property {(responder: (req: {url:string, method:string, headers:[string,string][], body:Uint8Array}) => ({status?:number, statusText?:string, headers?:[string,string][], body?:string|Uint8Array}|Promise<object>)) => Promise<void>} serve
 *   Install the far end of the network: every request a program makes
 *   through the kernel's proxy (http and https alike) reaches `responder`.
 *   It runs in the page, so it must be self-contained (no closures).
 * @property {(argv: string[], opts?: PtyOptions) => Promise<PtyResult>} pty
 *   Run `argv` as the session leader of a real terminal (kernel.openTerminal)
 *   and script it: each step waits for its `expect` regex in the output
 *   since the previous match, then types `write`.
 * @property {{ errors: string[] }} page
 */
/**
 * @typedef {object} PtyOptions
 * @property {number} [cols] default 80
 * @property {number} [rows] default 24
 * @property {Record<string,string>} [env] TERM=xterm-256color is added by the kernel
 * @property {string} [cwd] default /home
 * @property {{expect?: string, flags?: string, write?: string, sleepMs?: number, timeoutMs?: number}[]} [steps]
 * @property {number} [timeoutMs] wait for exit after the last step (default 15000), then hang up
 */
/**
 * @typedef {object} PtyResult
 * @property {number|null} status exit status, or null if it had to be hung up
 * @property {string} out everything the terminal printed (escape sequences included)
 * @property {object} [failedStep] the step whose `expect` never appeared
 */

import assert from 'node:assert/strict';

/**
 * Drive a pty session. Self-contained: it is serialized into the page for
 * the browser harness and called directly with a Node kernel.
 * @param {{ openTerminal: Function }} kernel
 * @param {string[]} argv
 * @param {PtyOptions} [o]
 * @returns {Promise<PtyResult>}
 */
export async function ptySession(kernel, argv, o = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dec = new TextDecoder();
  let out = '';
  let mark = 0;
  const t = await kernel.openTerminal(argv, {
    cols: o.cols ?? 80,
    rows: o.rows ?? 24,
    env: o.env ?? {},
    cwd: o.cwd ?? '/home',
  });
  t.onData = (b) => {
    out += dec.decode(b instanceof Uint8Array ? b : new Uint8Array(b), { stream: true });
  };
  for (const step of o.steps ?? []) {
    if (step.expect) {
      const re = new RegExp(step.expect, step.flags ?? '');
      const until = Date.now() + (step.timeoutMs ?? 10000);
      let m;
      while (!(m = re.exec(out.slice(mark)))) {
        if (Date.now() > until) {
          t.close();
          await sleep(50);
          return { status: null, out, failedStep: step };
        }
        await sleep(20);
      }
      mark += m.index + m[0].length;
    }
    if (step.sleepMs) await sleep(step.sleepMs);
    if (step.write !== undefined) t.write(step.write);
  }
  const status = await Promise.race([t.exited, sleep(o.timeoutMs ?? 15000).then(() => null)]);
  if (status === null) t.close();
  await sleep(50);
  return { status, out };
}

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
    async pty(argv, opts = {}) {
      return page.evaluate(
        (src, a, o) => new Function(`return (${src})`)()(window.kernel, a, o),
        ptySession.toString(),
        argv,
        opts,
      );
    },
    async read(path) {
      return page.evaluate((p) => window.opfs.read(p), path.replace(/^\//, ''));
    },
    async uplink(cfg) {
      await page.evaluate((c) => window.certSetUplink(c), cfg);
    },
    async uplinkLog() {
      return page.evaluate(() => window.certUplinkLog);
    },
  };
}
