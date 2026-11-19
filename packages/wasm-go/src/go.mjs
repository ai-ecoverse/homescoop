/**
 * go: a Go driver for slicc-kernel (a JS program, "abi": "js").
 *
 * cmd/go itself can't drive the toolchain in WASI (wasip1 has no processes),
 * so this file plans the build and runs this package's compile, link and asm
 * (WASI programs) by path, as cmd/go would:
 *
 *   go build [-o out] [-v] [-x] [-trimpath] [-tags t] [-ldflags f] [-gcflags f] [pkgs | files]
 *   go run [build flags] pkg|files [args]
 *   go mod download [modules]
 *   go version | go env [-json] [VAR...]
 *
 * Packages: the standard library (precompiled archives from an installed
 * wasm-go-std-* package of the same Go version and target), the main
 * module's packages, and required modules, from vendor/ when it is there,
 * else from GOMODCACHE, downloaded from GOPROXY and checked against go.sum
 * (h1 hashes) first. Build constraints (file names, //go:build, // +build),
 * //go:embed and Go assembly (.s) are handled; cgo is not (CGO_ENABLED=0).
 * Compiled archives are cached in GOCACHE by a hash of their inputs.
 */

const TE = new TextEncoder();
const TD = new TextDecoder();

class GoError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const KNOWN_OS = new Set('aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos'.split(' '));
const KNOWN_ARCH = new Set('386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm'.split(' '));
const UNIX = new Set('aix android darwin dragonfly freebsd hurd illumos ios linux netbsd openbsd solaris'.split(' '));

const USAGE = `Go is a tool for managing Go source code (slicc-kernel driver).

Usage:

\tgo <command> [arguments]

The commands are:

\tbuild       compile packages and dependencies
\trun         compile and run Go program
\tmod         module maintenance (download)
\tenv         print Go environment information
\tversion     print Go version

Builds are for GOOS=wasip1 GOARCH=wasm unless the environment says otherwise.
No cgo, tests (go test), go.work or go get yet.
`;

// ---------------------------------------------------------------- utilities

const dirname = (p) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
function normalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}
const join = (...parts) => normalize(parts.join('/'));

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? TE.encode(bytes) : bytes));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function base64(b) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** Module path escaping for the proxy and the module cache: A → !a. */
const escapePath = (p) => p.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

function splitQuoted(value) {
  return (value.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((s) => s.replace(/^(['"])(.*)\1$/, '$2'));
}

// ------------------------------------------------------------------- driver

class Driver {
  constructor(ctx) {
    this.ctx = ctx;
    this.env = { ...ctx.env };
    this.cwd = ctx.cwd;
    this.fs = ctx.fs;
    this.main = undefined;
  }

  out(text) {
    return this.ctx.write(1, text);
  }

  err(text) {
    return this.ctx.write(2, text);
  }

  async exists(p) {
    try {
      return await this.fs.exists(p);
    } catch {
      return false;
    }
  }

  async isDir(p) {
    try {
      return (await this.fs.stat(p)).isDirectory;
    } catch {
      return false;
    }
  }

  async readText(p) {
    return TD.decode(await this.fs.readFile(p));
  }

  async entries(dir) {
    const names = (await this.fs.readdir(dir)).sort();
    const out = [];
    for (const name of names) {
      try {
        const st = await this.fs.stat(`${dir}/${name}`);
        out.push({ name, dir: st.isDirectory, file: st.isFile });
      } catch {}
    }
    return out;
  }

  async mkdirp(p) {
    await this.fs.mkdir(p, { recursive: true });
  }

  // ------------------------------------------------------------ environment

  async setup() {
    const e = this.env;
    this.home = e.HOME || '/tmp';
    this.goos = e.GOOS || 'wasip1';
    this.goarch = e.GOARCH || 'wasm';
    this.pkgDir = e.SLICC_GO_PACKAGE || '';
    this.goroot = e.GOROOT || `${this.pkgDir}/goroot`;
    if (!(await this.exists(`${this.goroot}/VERSION`))) {
      throw new GoError(`go: cannot find GOROOT (${this.goroot}/VERSION is missing): reinstall @ai-ecoverse/wasm-go`);
    }
    this.version = (await this.readText(`${this.goroot}/VERSION`)).split('\n')[0].trim();
    this.minor = Number(/^go1\.(\d+)/.exec(this.version)?.[1] ?? 0);
    this.tools = `${this.goroot}/pkg/tool/wasip1_wasm`;
    this.gopath = (e.GOPATH || `${this.home}/go`).split(':')[0];
    this.modcache = e.GOMODCACHE || `${this.gopath}/pkg/mod`;
    this.gocache = e.GOCACHE || `${this.home}/.cache/go-build-slicc`;
    this.goproxy = e.GOPROXY || 'https://proxy.golang.org,direct';
    this.goflags = e.GOFLAGS ? splitQuoted(e.GOFLAGS) : [];
    this.tmp = e.TMPDIR || '/tmp';
  }

  /** The std archives for the target: import path → .a, from every installed wasm-go-std-* part. */
  async stdArchives() {
    if (this.std) return this.std;
    const target = `${this.goos}/${this.goarch}`;
    const roots = new Set();
    if (this.pkgDir) roots.add(dirname(dirname(this.pkgDir)));
    for (const home of [this.env.PNPM_HOME, `${this.home}/.local/share/pnpm`, '/usr/local/share/pnpm']) {
      if (!home || !(await this.isDir(`${home}/global`))) continue;
      for (const v of await this.entries(`${home}/global`)) {
        if (!v.dir) continue;
        for (const proj of await this.entries(`${home}/global/${v.name}`)) {
          if (proj.dir) roots.add(`${home}/global/${v.name}/${proj.name}/node_modules`);
        }
      }
    }
    roots.add('/node_modules');
    const parts = [];
    for (const root of roots) {
      if (!(await this.isDir(root))) continue;
      const dirs = [];
      for (const e of await this.entries(root)) {
        if (!e.name.startsWith('@')) dirs.push(`${root}/${e.name}`);
        else if (e.dir) for (const s of await this.entries(`${root}/${e.name}`)) dirs.push(`${root}/${e.name}/${s.name}`);
      }
      for (const dir of dirs) {
        let manifest;
        try {
          manifest = JSON.parse(await this.readText(`${dir}/package.json`));
        } catch {
          continue;
        }
        const go = manifest?.slicc?.go;
        if (!go || !Array.isArray(go.std)) continue;
        for (const part of go.std) {
          const version = part?.version ?? go.version;
          if (version !== this.version || part?.target !== target || typeof part.dir !== 'string') continue;
          if (part.dir.startsWith('/') || part.dir.split('/').includes('..')) continue;
          parts.push(`${dir}/${part.dir}`);
        }
      }
    }
    if (parts.length === 0) {
      throw new GoError(`go: no standard library for ${target} ${this.version}: install @ai-ecoverse/wasm-go-std-${this.goos === 'wasip1' ? 'wasip1' : `${this.goos}-${this.goarch}`} of the same version`);
    }
    const std = new Map();
    const walk = async (dir, prefix) => {
      for (const e of await this.entries(dir)) {
        if (e.dir) await walk(`${dir}/${e.name}`, `${prefix}${e.name}/`);
        else if (e.name.endsWith('.a')) {
          const path = prefix + e.name.slice(0, -2);
          if (!std.has(path)) std.set(path, `${dir}/${e.name}`);
        }
      }
    };
    for (const part of parts) await walk(part, '');
    this.std = std;
    return std;
  }

  toolEnv() {
    return { ...this.env, GOOS: this.goos, GOARCH: this.goarch, GOROOT: this.goroot, CGO_ENABLED: '0' };
  }

  /** Runs a tool to its end; a failure prints go's `# pkg` header and the tool's output. */
  tool(name, args, pkg) {
    const argv = [`${this.tools}/${name}`, ...args];
    if (this.flags?.trace) this.ctx.sync.write(2, `${argv.join(' ')}\n`);
    const r = this.ctx.sync.run({ argv, env: this.toolEnv(), cwd: this.cwd, maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw new GoError(`go: cannot run ${name}: ${r.error.code ?? r.error}`);
    if (r.status !== 0) {
      const text = TD.decode(r.stderr ?? new Uint8Array()) + TD.decode(r.stdout ?? new Uint8Array());
      const base = this.cwd === '/' ? '/' : `${this.cwd}/`;
      const shown = text.split(base).join('./');
      throw new GoError(`# ${pkg}\n${shown}${shown.endsWith('\n') || !shown ? '' : '\n'}`);
    }
  }

  // ---------------------------------------------------------------- modules

  async findMainModule(dir) {
    for (let d = dir; ; d = dirname(d)) {
      if (await this.exists(`${d}/go.mod`)) return this.loadModule(d, true);
      if (d === '/') return undefined;
    }
  }

  async loadModule(dir, main) {
    const mod = parseGoMod(await this.readText(`${dir}/go.mod`), `${dir}/go.mod`);
    mod.dir = dir;
    mod.main = main;
    if (main) {
      mod.sum = (await this.exists(`${dir}/go.sum`)) ? parseGoSum(await this.readText(`${dir}/go.sum`)) : new Map();
      const vendored = await this.exists(`${dir}/vendor/modules.txt`);
      const flag = this.flags?.mod ?? (this.goflags.find((f) => f.startsWith('-mod='))?.slice(5));
      mod.vendor = flag === 'vendor' || (flag !== 'mod' && vendored && (mod.go ? versionAtLeast(mod.go, '1.14') : false));
      if (mod.vendor && !vendored) throw new GoError('go: -mod=vendor but vendor/modules.txt is missing');
    }
    return mod;
  }

  /** The module that provides `path`: [module, dir of the package] or undefined. */
  async resolveImport(path) {
    const main = this.main;
    if (main && (path === main.path || path.startsWith(`${main.path}/`))) {
      return [main, main.dir + path.slice(main.path.length)];
    }
    if (!main) return undefined;
    if (main.vendor) {
      const dir = `${main.dir}/vendor/${path}`;
      if (await this.isDir(dir)) {
        const req = [...main.require.keys()].filter((m) => path === m || path.startsWith(`${m}/`)).sort((a, b) => b.length - a.length)[0];
        return [{ path: req ?? path, dir: `${main.dir}/vendor/${req ?? path}`, go: undefined, vendored: true }, dir];
      }
      return undefined;
    }
    let best;
    for (const m of main.require.keys()) {
      if ((path === m || path.startsWith(`${m}/`)) && (!best || m.length > best.length)) best = m;
    }
    if (!best) return undefined;
    const mod = await this.moduleDir(best, main.require.get(best));
    return [mod, mod.dir + path.slice(best.length)];
  }

  /** A required module's source in the module cache (downloaded on first use), as a module record. */
  async moduleDir(path, version) {
    this.modules ??= new Map();
    const key = `${path}@${version}`;
    if (this.modules.has(key)) return this.modules.get(key);
    const rep = this.main.replace.get(`${path}@${version}`) ?? this.main.replace.get(path);
    let mod;
    if (rep && rep.dir) {
      const dir = rep.dir.startsWith('/') ? rep.dir : join(this.main.dir, rep.dir);
      mod = (await this.exists(`${dir}/go.mod`)) ? await this.loadModule(dir, false) : { path, dir };
      mod.path = path;
    } else {
      const [p, v] = rep ? [rep.path, rep.version] : [path, version];
      const dir = `${this.modcache}/${escapePath(p)}@${escapePath(v)}`;
      if (!(await this.exists(`${dir}/.slicc-ok`)) && !(await this.exists(`${dir}/go.mod`))) await this.download(p, v, dir);
      mod = (await this.exists(`${dir}/go.mod`)) ? await this.loadModule(dir, false) : { path: p, dir };
      mod.path = path;
      mod.version = v;
    }
    this.modules.set(key, mod);
    return mod;
  }

  async download(path, version, dir) {
    const want = this.main.sum.get(`${path} ${version}`);
    if (!want) {
      throw new GoError(`go: missing go.sum entry for module providing ${path}@${version}; add it to go.sum (go mod download ${path} on another machine)`);
    }
    const proxies = this.goproxy.split(/[,|]/).filter((p) => p && p !== 'direct' && p !== 'off');
    if (proxies.length === 0) throw new GoError(`go: ${path}@${version}: GOPROXY=${this.goproxy} has no proxy to download from (direct VCS fetches are not supported)`);
    if (typeof this.ctx.fetch !== 'function') {
      throw new GoError(`go: ${path}@${version}: this slicc-kernel gives JS programs no fetch; vendor the modules (vendor/) to build offline`);
    }
    let zip;
    let lastErr = '';
    for (const proxy of proxies) {
      const url = `${proxy.replace(/\/$/, '')}/${escapePath(path)}/@v/${escapePath(version)}.zip`;
      if (this.flags?.verbose || this.flags?.trace) this.ctx.sync.write(2, `go: downloading ${path} ${version}\n`);
      try {
        const r = await this.ctx.fetch(url);
        if (r.status === 200) {
          zip = new Uint8Array(await r.arrayBuffer());
          break;
        }
        lastErr = `${url}: ${r.status}`;
        if (r.status !== 404 && r.status !== 410) break;
      } catch (e) {
        lastErr = `${url}: ${e.message ?? e}`;
        break;
      }
    }
    if (!zip) throw new GoError(`go: ${path}@${version}: ${lastErr}`);
    const files = await unzip(zip);
    const lines = [];
    for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (f.name.includes('\n')) throw new GoError(`go: ${path}@${version}: bad file name in zip`);
      lines.push(`${hex(await sha256(f.data))}  ${f.name}\n`);
    }
    const got = `h1:${base64(await sha256(lines.join('')))}`;
    if (got !== want) {
      throw new GoError(`go: ${path}@${version}: verifying module: checksum mismatch\n\tdownloaded: ${got}\n\tgo.sum:     ${want}\n\nSECURITY ERROR\nThis download does NOT match an earlier download recorded in go.sum.`);
    }
    const prefix = `${path}@${version}/`;
    const tmp = `${dir}.tmp-${Date.now()}`;
    for (const f of files) {
      if (!f.name.startsWith(prefix)) throw new GoError(`go: ${path}@${version}: zip entry ${f.name} outside ${prefix}`);
      const rel = f.name.slice(prefix.length);
      if (rel.split('/').some((s) => s === '..' || s === '')) throw new GoError(`go: ${path}@${version}: bad zip entry ${f.name}`);
      await this.mkdirp(dirname(`${tmp}/${rel}`));
      await this.fs.writeFile(`${tmp}/${rel}`, f.data);
    }
    await this.fs.writeFile(`${tmp}/.slicc-ok`, `${got}\n`);
    await this.mkdirp(dirname(dir));
    await this.fs.rename(tmp, dir);
  }

  // --------------------------------------------------------------- packages

  tagSet() {
    const tags = new Set([this.goos, this.goarch, 'gc', ...(this.flags?.tags ?? [])]);
    if (UNIX.has(this.goos)) tags.add('unix');
    if (this.goos === 'android') tags.add('linux');
    if (this.goos === 'illumos') tags.add('solaris');
    if (this.goos === 'ios') tags.add('darwin');
    return tags;
  }

  matchTag(tag) {
    const m = /^go1\.(\d+)$/.exec(tag);
    if (m) return Number(m[1]) <= this.minor;
    return this.tags.has(tag);
  }

  matchFile(name) {
    let stem = name.replace(/\.[^.]*$/, '');
    if (stem.endsWith('_test')) return false;
    const parts = stem.split('_');
    const n = parts.length;
    if (n >= 2 && KNOWN_OS.has(parts[n - 2]) && KNOWN_ARCH.has(parts[n - 1])) {
      return this.matchTag(parts[n - 2]) && parts[n - 1] === this.goarch;
    }
    if (n >= 2 && KNOWN_OS.has(parts[n - 1])) return this.matchTag(parts[n - 1]);
    if (n >= 2 && KNOWN_ARCH.has(parts[n - 1])) return parts[n - 1] === this.goarch;
    return true;
  }

  /** Loads the package in `dir` with import path `path`. */
  async loadPackage(dir, path, mod, files) {
    const pkg = { path, dir, mod, goFiles: [], sFiles: [], imports: new Set(), embeds: [], name: undefined };
    const names = files ?? (await this.entries(dir)).filter((e) => e.file).map((e) => e.name);
    let sawGo = false;
    for (const name of names) {
      const file = files ? name : `${dir}/${name}`;
      const base = basename(file);
      if (base.startsWith('.') || base.startsWith('_')) continue;
      const ext = base.slice(base.lastIndexOf('.'));
      if (!['.go', '.s', '.c', '.cc', '.cpp', '.cxx', '.m', '.h', '.hh', '.hpp', '.S', '.sx', '.f', '.F', '.for', '.f90', '.syso'].includes(ext)) continue;
      if (!files && !this.matchFile(base)) continue;
      const text = await this.readText(file);
      const header = parseHeader(text, ext === '.go');
      if (header.build !== undefined && !evalConstraint(header.build, (t) => this.matchTag(t))) continue;
      if (header.plusBuild.length && header.build === undefined && !header.plusBuild.every((line) => evalPlusBuild(line, (t) => this.matchTag(t)))) continue;
      if (ext === '.s') {
        pkg.sFiles.push(file);
        continue;
      }
      if (ext === '.h') continue;
      if (ext !== '.go') {
        if (ext === '.syso') continue;
        throw new GoError(`package ${path}: ${base}: C/C++/Fortran sources need cgo, and this go builds with CGO_ENABLED=0`);
      }
      if (header.pkg === 'documentation') continue;
      sawGo = true;
      if (header.cgo) {
        if (this.tagSet().has('cgo')) throw new GoError(`package ${path}: ${base}: import "C": cgo is not supported`);
        continue;
      }
      if (pkg.name && header.pkg !== pkg.name) {
        throw new GoError(`found packages ${pkg.name} (${basename(pkg.goFiles[0])}) and ${header.pkg} (${base}) in ${dir}`);
      }
      pkg.name = header.pkg;
      pkg.goFiles.push(file);
      for (const imp of header.imports) pkg.imports.add(imp);
      if (header.embeds.length) pkg.embeds.push(...header.embeds.map((p) => ({ pattern: p, file })));
    }
    if (!pkg.goFiles.length) {
      throw new GoError(sawGo ? `package ${path}: build constraints exclude all Go files in ${dir}` : `no Go files in ${dir}`);
    }
    return pkg;
  }

  /** Resolves `path` (an import) to a package, loading its dependencies; returns 'std' for std. */
  async importPackage(path, from) {
    if (this.pkgs.has(path)) return this.pkgs.get(path);
    const std = await this.stdArchives();
    const first = path.split('/')[0];
    if (!first.includes('.') && !(this.main && (path === this.main.path || path.startsWith(`${this.main.path}/`)))) {
      if (std.has(path)) return 'std';
      throw new GoError(`package ${path} is not in std (${this.goroot}/src/${path})${from ? `\n\timported by ${from}` : ''}`);
    }
    if (path === 'C') throw new GoError(`${from}: import "C": cgo is not supported`);
    const found = await this.resolveImport(path);
    if (!found || !(await this.isDir(found[1]))) {
      throw new GoError(`no required module provides package ${path}; to add it:\n\tgo get ${path}${from ? `\n\timported by ${from}` : ''}`);
    }
    return this.addPackage(await this.loadPackage(found[1], path, found[0]));
  }

  async addPackage(pkg) {
    if (this.loading.has(pkg.path)) throw new GoError(`import cycle not allowed: ${[...this.loading, pkg.path].join(' -> ')}`);
    this.loading.add(pkg.path);
    pkg.deps = [];
    for (const imp of [...pkg.imports].sort()) {
      if (imp === 'unsafe') continue;
      const dep = await this.importPackage(imp, pkg.path);
      if (dep !== 'std') pkg.deps.push(dep);
    }
    this.loading.delete(pkg.path);
    this.pkgs.set(pkg.path, pkg);
    this.order.push(pkg);
    return pkg;
  }

  /** Expands build arguments into root packages. */
  async roots(args) {
    this.pkgs = new Map();
    this.loading = new Set();
    this.order = [];
    if (args.length === 0) args = ['.'];
    if (args.every((a) => a.endsWith('.go'))) {
      const files = args.map((a) => (a.startsWith('/') ? normalize(a) : join(this.cwd, a)));
      const dirs = new Set(files.map(dirname));
      if (dirs.size > 1) throw new GoError('named files must all be in one directory; have ' + [...dirs].join(' and '));
      this.main ??= await this.findMainModule([...dirs][0]);
      const pkg = await this.loadPackage([...dirs][0], 'command-line-arguments', this.main, files);
      return [await this.addPackage(pkg)];
    }
    this.main ??= await this.findMainModule(this.cwd);
    const out = [];
    for (const arg of args) {
      if (arg.startsWith('.') || arg.startsWith('/')) {
        const recursive = arg.endsWith('/...');
        const base = arg.startsWith('/') ? normalize(recursive ? arg.slice(0, -4) : arg) : join(this.cwd, recursive ? arg.slice(0, -4) : arg);
        const dirs = recursive ? await this.walkPackages(base) : [base];
        for (const dir of dirs) {
          const path = this.importPathOf(dir);
          if (this.pkgs.has(path)) {
            out.push(this.pkgs.get(path));
            continue;
          }
          try {
            out.push(await this.addPackage(await this.loadPackage(dir, path, this.main)));
          } catch (e) {
            if (recursive && e instanceof GoError && /^no Go files|build constraints exclude/.test(e.message.replace(/^package \S+: /, ''))) continue;
            throw e;
          }
        }
        if (recursive && out.length === 0) this.err(`go: warning: "${arg}" matched no packages\n`);
      } else {
        const dep = await this.importPackage(arg);
        if (dep === 'std') throw new GoError(`go: ${arg} is in the standard library, which is prebuilt here; nothing to build`);
        out.push(dep);
      }
    }
    return out;
  }

  importPathOf(dir) {
    const m = this.main;
    if (!m) throw new GoError('go: go.mod file not found in current directory or any parent directory; see "go help modules"');
    if (dir !== m.dir && !dir.startsWith(`${m.dir}/`)) throw new GoError(`directory ${dir} is outside main module (${m.dir})`);
    return m.path + dir.slice(m.dir.length);
  }

  async walkPackages(base) {
    const out = [];
    const walk = async (dir) => {
      const entries = await this.entries(dir);
      if (entries.some((e) => e.file && e.name.endsWith('.go'))) out.push(dir);
      for (const e of entries) {
        if (!e.dir || e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'testdata' || (e.name === 'vendor' && dir === this.main?.dir)) continue;
        if (await this.exists(`${dir}/${e.name}/go.mod`)) continue;
        await walk(`${dir}/${e.name}`);
      }
    };
    await walk(base);
    return out;
  }

  // ------------------------------------------------------------------ build

  langOf(pkg) {
    if (pkg.path === 'command-line-arguments' || pkg.mod?.main) return this.main?.go ? [`-lang=go${langVersion(this.main.go)}`] : [];
    if (pkg.mod?.vendored) return [];
    return [`-lang=go${langVersion(pkg.mod?.go ?? '1.16')}`];
  }

  async embedCfg(pkg, work) {
    if (!pkg.embeds.length) return [];
    const patterns = {};
    const files = {};
    for (const { pattern } of pkg.embeds) {
      if (patterns[pattern]) continue;
      const all = pattern.startsWith('all:');
      const glob = all ? pattern.slice(4) : pattern;
      if (glob.startsWith('/') || glob.split('/').includes('..') || glob.split('/').includes('.')) throw new GoError(`${pkg.path}: pattern ${pattern}: invalid pattern syntax`);
      const matched = [];
      const segs = glob.split('/');
      const expand = async (dir, i, rel) => {
        if (i === segs.length) {
          if (await this.isDir(dir)) {
            const walk = async (d, r) => {
              for (const e of await this.entries(d)) {
                if (!all && (e.name.startsWith('.') || e.name.startsWith('_'))) continue;
                if (e.dir) await walk(`${d}/${e.name}`, `${r}/${e.name}`);
                else if (e.file) matched.push(`${r}/${e.name}`);
              }
            };
            await walk(dir, rel);
          } else matched.push(rel);
          return;
        }
        if (!(await this.isDir(dir))) return;
        const re = globToRegExp(segs[i]);
        for (const e of await this.entries(dir)) {
          if (re.test(e.name)) await expand(`${dir}/${e.name}`, i + 1, rel ? `${rel}/${e.name}` : e.name);
        }
      };
      await expand(pkg.dir, 0, '');
      if (!matched.length) throw new GoError(`${pkg.path}: pattern ${pattern}: no matching files found`);
      patterns[pattern] = matched.sort();
      for (const m of matched) files[m] = `${pkg.dir}/${m}`;
    }
    const cfg = `${work}/embedcfg`;
    await this.fs.writeFile(cfg, JSON.stringify({ Patterns: patterns, Files: files }));
    return [`-embedcfg=${cfg}`];
  }

  async build(roots, { output, link }) {
    const std = await this.stdArchives();
    const work = `${this.tmp}/go-build${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await this.mkdirp(work);
    this.work = work;
    const archives = new Map();
    const keys = new Map();
    try {
      let n = 0;
      for (const pkg of this.order) {
        const obj = `${work}/b${String(++n).padStart(3, '0')}`;
        await this.mkdirp(obj);
        const pathArg = pkg.name === 'main' ? 'main' : pkg.path;
        const trim = this.flags.trimpath ? [`-trimpath=${pkg.dir}=>${pkg.path === 'command-line-arguments' ? pkg.path : pkg.path}`] : [`-trimpath=${obj}=>`];
        const lang = this.langOf(pkg);
        const embed = await this.embedCfg(pkg, obj);
        // cache key: everything compile sees
        const parts = [this.version, this.goos, this.goarch, pkg.path, pathArg, lang.join(' '), (this.flags.gcflags ?? []).join(' '), this.flags.trimpath ? 'trim' : '', pkg.dir];
        for (const f of [...pkg.goFiles, ...pkg.sFiles]) parts.push(f, hex(await sha256(await this.fs.readFile(f))));
        for (const e of embed) parts.push(await this.readText(e.slice('-embedcfg='.length)));
        for (const imp of [...pkg.imports].sort()) parts.push(imp, keys.get(imp) ?? 'std');
        const key = hex(await sha256(parts.join('\0')));
        keys.set(pkg.path, key);
        const cached = `${this.gocache}/${key.slice(0, 2)}/${key}.a`;
        if (this.flags.verbose) this.ctx.sync.write(2, `${pkg.path}\n`);
        if (!this.flags.force && (await this.exists(cached))) {
          archives.set(pkg.path, cached);
          continue;
        }
        const cfg = `${obj}/importcfg`;
        const lines = ['# import config'];
        for (const imp of [...pkg.imports].sort()) {
          const a = archives.get(imp) ?? std.get(imp);
          if (a) lines.push(`packagefile ${imp}=${a}`);
        }
        await this.fs.writeFile(cfg, `${lines.join('\n')}\n`);
        const out = `${obj}/_pkg_.a`;
        const asm = pkg.sFiles.length > 0;
        const inc = ['-I', obj, '-I', `${this.goroot}/pkg/include`, '-D', `GOOS_${this.goos}`, '-D', `GOARCH_${this.goarch}`];
        if (asm) {
          await this.fs.writeFile(`${obj}/go_asm.h`, '');
          this.tool('asm', ['-p', pathArg, ...inc, '-gensymabis', '-o', `${obj}/symabis`, ...pkg.sFiles], pkg.path);
        }
        this.tool('compile', ['-o', out, ...trim, '-p', pathArg, ...lang, ...(asm ? ['-symabis', `${obj}/symabis`, '-asmhdr', `${obj}/go_asm.h`] : ['-complete']), ...embed, '-importcfg', cfg, ...(this.flags.gcflags ?? []), '-pack', ...pkg.goFiles], pkg.path);
        if (asm) {
          const objs = [];
          for (const s of pkg.sFiles) {
            const o = `${obj}/${basename(s).replace(/\.s$/, '.o')}`;
            this.tool('asm', ['-p', pathArg, ...inc, '-o', o, s], pkg.path);
            objs.push(o);
          }
          await this.appendArchive(out, objs);
        }
        await this.mkdirp(dirname(cached));
        const tmp = `${cached}.tmp${Math.random().toString(36).slice(2, 8)}`;
        await this.fs.writeFile(tmp, await this.fs.readFile(out));
        await this.fs.rename(tmp, cached);
        archives.set(pkg.path, cached);
      }
      if (!link) return;
      const mains = roots.filter((p) => p.name === 'main');
      if (output === undefined && roots.length > 1) return;
      const linkcfg = `${work}/importcfg.link`;
      const lines = ['# import config'];
      for (const [p, a] of archives) lines.push(`packagefile ${p}=${a}`);
      for (const [p, a] of std) if (!archives.has(p)) lines.push(`packagefile ${p}=${a}`);
      await this.fs.writeFile(linkcfg, `${lines.join('\n')}\n`);
      const written = [];
      for (const root of mains) {
        let exe = output ?? join(this.cwd, exeName(root, this.goos));
        if (output !== undefined && (output.endsWith('/') || (await this.isDir(output)))) exe = join(output, exeName(root, this.goos));
        const tmpExe = `${work}/exe-${written.length}`;
        this.tool('link', ['-o', tmpExe, '-importcfg', linkcfg, '-buildmode=exe', ...(this.flags.ldflags ?? []), archives.get(root.path)], root.path);
        await this.fs.writeFile(exe, await this.fs.readFile(tmpExe));
        await this.fs.chmod(exe, 0o755);
        written.push(exe);
      }
      if (output !== undefined && mains.length === 0) {
        throw new GoError(`go: -o ${output}: ${roots[0].path} is not a main package`);
      }
      return written;
    } finally {
      if (!this.flags.keepWork) await this.fs.rm(work, { recursive: true }).catch(() => {});
      else this.err(`WORK=${work}\n`);
    }
  }

  /** Appends objects to a Go archive (what `go tool pack r` does). */
  async appendArchive(archive, objects) {
    const chunks = [await this.fs.readFile(archive)];
    for (const o of objects) {
      const data = await this.fs.readFile(o);
      const name = basename(o);
      const head = `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'644'.padEnd(8)}${String(data.length).padEnd(10)}\`\n`;
      chunks.push(TE.encode(head), data);
      if (data.length % 2) chunks.push(TE.encode('\n'));
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      buf.set(c, at);
      at += c.length;
    }
    await this.fs.writeFile(archive, buf);
  }

  // --------------------------------------------------------------- commands

  parseBuildFlags(args, { stopAtFirstArg }) {
    const flags = { tags: [], ldflags: [], gcflags: [] };
    const takesValue = new Set(['-o', '-tags', '-ldflags', '-gcflags', '-mod', '-C', '-p', '-modfile', '-asmflags', '-pgo', '-overlay', '-installsuffix']);
    const boolean = new Set(['-v', '-x', '-a', '-n', '-trimpath', '-work', '-buildvcs=false', '-buildvcs', '-modcacherw', '-race=false', '-linkshared=false']);
    const refused = new Set(['-race', '-msan', '-asan', '-cover', '-linkshared', '-buildmode']);
    const rest = [];
    const all = [...this.goflags, ...args];
    let i = 0;
    for (; i < all.length; i++) {
      let a = all[i];
      if (a === '--') {
        i++;
        break;
      }
      if (!a.startsWith('-') || a === '-') {
        if (stopAtFirstArg) break;
        rest.push(a);
        continue;
      }
      a = a.replace(/^--/, '-');
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (refused.has(name) && !boolean.has(a)) {
        if (name === '-buildmode' && (a === '-buildmode=exe' || (eq < 0 && all[i + 1] === 'exe') || a === '-buildmode=default')) {
          if (eq < 0) i++;
          continue;
        }
        throw new GoError(`go: ${name} is not supported by this go driver`, 2);
      }
      if (boolean.has(a) || boolean.has(name)) {
        if (name === '-v') flags.verbose = true;
        else if (name === '-x') flags.trace = true;
        else if (name === '-a') flags.force = true;
        else if (name === '-trimpath') flags.trimpath = true;
        else if (name === '-work') flags.keepWork = true;
        else if (name === '-n') throw new GoError('go: -n is not supported by this go driver', 2);
        continue;
      }
      if (!takesValue.has(name)) throw new GoError(`flag provided but not defined: ${name}\nusage: go build [-o output] [build flags] [packages]`, 2);
      let value;
      if (eq > 0) value = a.slice(eq + 1);
      else {
        if (i + 1 >= all.length) throw new GoError(`flag needs an argument: ${name}`, 2);
        value = all[++i];
      }
      if (name === '-o') flags.output = value.startsWith('/') ? normalize(value) + (value.endsWith('/') ? '/' : '') : join(this.cwd, value) + (value.endsWith('/') ? '/' : '');
      else if (name === '-tags') flags.tags.push(...value.split(/[,\s]+/).filter(Boolean));
      else if (name === '-ldflags') flags.ldflags = splitQuoted(value.replace(/^all=/, ''));
      else if (name === '-gcflags') flags.gcflags = splitQuoted(value.replace(/^all=/, ''));
      else if (name === '-mod') flags.mod = value;
      else if (name === '-C') this.cwd = value.startsWith('/') ? normalize(value) : join(this.cwd, value);
      else if (['-modfile', '-overlay', '-pgo'].includes(name) && !(name === '-pgo' && value === 'off')) {
        throw new GoError(`go: ${name} is not supported by this go driver`, 2);
      }
    }
    for (; i < all.length; i++) rest.push(all[i]);
    return { flags, rest };
  }

  async cmdBuild(args) {
    const { flags, rest } = this.parseBuildFlags(args, { stopAtFirstArg: false });
    this.flags = flags;
    this.tags = this.tagSet();
    const roots = await this.roots(rest);
    if (flags.output !== undefined && roots.length > 1 && !flags.output.endsWith('/') && !(await this.isDir(flags.output))) {
      throw new GoError('go: -o requires a directory when building more than one package', 1);
    }
    await this.build(roots, { output: flags.output, link: true });
    return 0;
  }

  async cmdRun(args) {
    const { flags, rest } = this.parseBuildFlags(args, { stopAtFirstArg: true });
    this.flags = flags;
    this.tags = this.tagSet();
    if (rest.length === 0) throw new GoError('go: no go files listed', 1);
    let n = 1;
    if (rest[0].endsWith('.go')) while (n < rest.length && rest[n].endsWith('.go')) n++;
    const targets = rest.slice(0, n);
    const progArgs = rest.slice(n);
    const roots = await this.roots(targets);
    if (roots.length !== 1) throw new GoError('go: pattern matches multiple packages');
    if (roots[0].name !== 'main') throw new GoError(`package ${roots[0].path} is not a main package`);
    const dir = `${this.tmp}/go-run${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.mkdirp(dir);
    try {
      const [exe] = await this.build(roots, { output: `${dir}/${exeName(roots[0], this.goos)}`, link: true });
      const r = this.ctx.sync.run({ argv: [exe, ...progArgs], argv0: basename(exe), env: this.env, cwd: this.cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      if (r.error) throw new GoError(`go: running ${exe}: ${r.error.code ?? r.error}`);
      return r.status ?? 128 + 1;
    } finally {
      await this.fs.rm(dir, { recursive: true }).catch(() => {});
    }
  }

  async cmdMod(args) {
    if (args[0] !== 'download') throw new GoError(`go mod ${args[0] ?? ''}: not supported by this go driver (only go mod download)`, 2);
    const { flags, rest } = this.parseBuildFlags(args.slice(1).filter((a) => a !== '-json'), { stopAtFirstArg: false });
    this.flags = flags;
    this.main = await this.findMainModule(this.cwd);
    if (!this.main) throw new GoError('go: go.mod file not found in current directory or any parent directory');
    const want = rest.length ? rest.map((r) => r.split('@')) : [...this.main.require];
    for (const [path, v] of want) {
      const version = v ?? this.main.require.get(path);
      if (!version) throw new GoError(`go: module ${path} is not required by ${this.main.path}`);
      await this.moduleDir(path, version);
    }
    return 0;
  }

  async cmdEnv(args) {
    const vars = {
      CGO_ENABLED: '0',
      GOARCH: this.goarch,
      GOCACHE: this.gocache,
      GOENV: 'off',
      GOFLAGS: this.env.GOFLAGS ?? '',
      GOHOSTARCH: 'wasm',
      GOHOSTOS: 'wasip1',
      GOMOD: '',
      GOMODCACHE: this.modcache,
      GOOS: this.goos,
      GOPATH: this.gopath,
      GOPROXY: this.goproxy,
      GOROOT: this.goroot,
      GOSUMDB: 'off',
      GOTOOLCHAIN: 'local',
      GOTOOLDIR: this.tools,
      GOVERSION: this.version,
    };
    const main = await this.findMainModule(this.cwd).catch(() => undefined);
    vars.GOMOD = main ? `${main.dir}/go.mod` : '/dev/null';
    const json = args.includes('-json');
    const names = args.filter((a) => a !== '-json');
    if (names.some((a) => a.startsWith('-'))) throw new GoError(`go env: ${names.find((a) => a.startsWith('-'))} is not supported by this go driver`, 2);
    const pick = names.length ? names : Object.keys(vars);
    if (json) {
      const o = {};
      for (const k of pick) o[k] = vars[k] ?? '';
      await this.out(`${JSON.stringify(o, null, '\t')}\n`);
    } else if (names.length) {
      await this.out(pick.map((k) => `${vars[k] ?? ''}\n`).join(''));
    } else {
      await this.out(pick.map((k) => `${k}='${vars[k]}'\n`).join(''));
    }
    return 0;
  }

  async run(argv) {
    const [cmd, ...args] = argv;
    if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
      await this.err(USAGE);
      return 2;
    }
    if (cmd === 'version' && args.length === 0) {
      await this.setup();
      await this.out(`go version ${this.version} ${this.goos}/${this.goarch}\n`);
      return 0;
    }
    await this.setup();
    switch (cmd) {
      case 'build':
        return this.cmdBuild(args);
      case 'run':
        return this.cmdRun(args);
      case 'env':
        return this.cmdEnv(args);
      case 'mod':
        return this.cmdMod(args);
      case 'version':
        throw new GoError('go version: reading the version of a binary is not supported by this go driver', 2);
      case 'test':
      case 'get':
      case 'install':
      case 'list':
      case 'vet':
      case 'generate':
      case 'work':
      case 'tool':
      case 'fmt':
      case 'clean':
        throw new GoError(`go ${cmd}: not supported by this go driver yet`, 2);
      default:
        throw new GoError(`go ${cmd}: unknown command\nRun 'go help' for usage.`, 2);
    }
  }
}

// ---------------------------------------------------------------- go.mod/sum

function parseGoMod(text, file) {
  const mod = { path: undefined, go: undefined, require: new Map(), replace: new Map() };
  const lines = text.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim());
  let block;
  const unquote = (s) => (s.startsWith('"') || s.startsWith('`') ? s.slice(1, -1) : s);
  const handle = (verb, rest, n) => {
    const f = rest.match(/"[^"]*"|`[^`]*`|\S+/g)?.map(unquote) ?? [];
    if (verb === 'module') mod.path = f[0];
    else if (verb === 'go') mod.go = f[0];
    else if (verb === 'require') {
      if (f.length < 2) throw new GoError(`${file}:${n}: usage: require module/path v1.2.3`);
      mod.require.set(f[0], f[1]);
    } else if (verb === 'replace') {
      const arrow = f.indexOf('=>');
      if (arrow < 1) throw new GoError(`${file}:${n}: usage: replace module/path [v1.2.3] => other/module v1.4 | ./dir`);
      const from = arrow === 2 ? `${f[0]}@${f[1]}` : f[0];
      const to = f.slice(arrow + 1);
      const local = to.length === 1 && (to[0].startsWith('./') || to[0].startsWith('../') || to[0].startsWith('/') || to[0] === '.' || to[0] === '..');
      mod.replace.set(from, local ? { dir: to[0] } : { path: to[0], version: to[1] });
    }
  };
  lines.forEach((line, i) => {
    if (!line) return;
    if (block) {
      if (line === ')') block = undefined;
      else handle(block, line, i + 1);
      return;
    }
    const m = /^(\w+)\s*(.*)$/.exec(line);
    if (!m) return;
    if (m[2] === '(') block = m[1];
    else handle(m[1], m[2], i + 1);
  });
  if (!mod.path) throw new GoError(`go: ${file}: no module declaration`);
  return mod;
}

function parseGoSum(text) {
  const sum = new Map();
  for (const line of text.split('\n')) {
    const [path, version, hash] = line.trim().split(/\s+/);
    if (path && version && hash) sum.set(`${path} ${version}`, hash);
  }
  return sum;
}

function versionAtLeast(v, want) {
  const a = v.split('.').map(Number);
  const b = want.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** go 1.21.3 → 1.21 (compile's -lang takes the language version). */
const langVersion = (v) => v.split('.').slice(0, 2).join('.').replace(/(rc|beta)\d*$/, '');

function exeName(pkg, goos) {
  let base;
  if (pkg.path === 'command-line-arguments') base = basename(pkg.goFiles[0]).replace(/\.go$/, '');
  else {
    const parts = pkg.path.split('/');
    if (parts.length > 1 && /^v\d+$/.test(parts[parts.length - 1])) parts.pop();
    base = parts[parts.length - 1];
  }
  return goos === 'windows' ? `${base}.exe` : base;
}

function globToRegExp(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = seg.indexOf(']', i + 1);
      if (end < 0) throw new GoError(`pattern ${seg}: invalid pattern syntax`);
      re += `[${seg.slice(i + 1, end).replace(/^\^/, '^').replace(/\\/g, '\\\\')}]`;
      i = end;
    } else if (c === '\\' && i + 1 < seg.length) re += `\\${seg[++i]}`;
    else re += c.replace(/[.+^${}()|]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// ------------------------------------------------------------------ sources

/**
 * The parts of a Go (or assembly) file go/build reads: the //go:build and
 * // +build lines before the package clause, the package name, the imports,
 * import "C" and //go:embed patterns.
 */
function parseHeader(text, isGo) {
  const out = { build: undefined, plusBuild: [], pkg: undefined, imports: [], cgo: false, embeds: [] };
  // Build lines: only in the leading run of comments and blank lines.
  let i = 0;
  const n = text.length;
  while (i < n) {
    const eol = text.indexOf('\n', i) < 0 ? n : text.indexOf('\n', i);
    const line = text.slice(i, eol).trim();
    if (line.startsWith('//')) {
      const m = /^\/\/go:build\s+(.*)$/.exec(line);
      if (m && out.build === undefined) out.build = m[1].trim();
      const p = /^\/\/\s*\+build\s+(.*)$/.exec(line);
      if (p) out.plusBuild.push(p[1].trim());
    } else if (line.startsWith('/*')) {
      const end = text.indexOf('*/', i);
      if (end < 0) break;
      i = end + 2;
      continue;
    } else if (line !== '') break;
    i = eol + 1;
  }
  if (!isGo) return out;
  const toks = tokenize(text);
  let t = 0;
  if (toks[t]?.v !== 'package') throw new GoError(`expected 'package', found ${toks[t]?.v ?? 'EOF'}`);
  out.pkg = toks[t + 1]?.v;
  t += 2;
  if (toks[t]?.v === ';') t++;
  const spec = () => {
    let name;
    if (toks[t]?.k === 'id' || toks[t]?.v === '.') name = toks[t++].v;
    const s = toks[t++];
    if (s?.k !== 'str') throw new GoError(`bad import spec near ${s?.v}`);
    out.imports.push(s.str);
    if (s.str === 'C') out.cgo = true;
    if (toks[t]?.v === ';') t++;
    return name;
  };
  while (toks[t]?.v === 'import') {
    t++;
    if (toks[t]?.v === '(') {
      t++;
      while (toks[t] && toks[t].v !== ')') {
        if (toks[t].v === ';') {
          t++;
          continue;
        }
        spec();
      }
      t++;
    } else spec();
    if (toks[t]?.v === ';') t++;
  }
  const re = /^[ \t]*\/\/go:embed[ \t]+(.*)$/gm;
  for (let m; (m = re.exec(text)); ) {
    for (const p of m[1].match(/"(?:[^"\\]|\\.)*"|`[^`]*`|\S+/g) ?? []) out.embeds.push(p.startsWith('"') ? JSON.parse(p) : p.startsWith('`') ? p.slice(1, -1) : p);
  }
  if (out.embeds.length && !out.imports.includes('embed')) throw new GoError('go:embed only allowed in Go files that import "embed"');
  return out;
}

/** Just enough of Go's scanner for the package clause and imports (with auto-semicolons). */
function tokenize(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  const push = (tok) => toks.push(tok);
  let lastNeedsSemi = false;
  while (i < n && toks.length < 4096) {
    const c = text[i];
    if (c === '\n') {
      if (lastNeedsSemi) push({ v: ';', k: 'p' });
      lastNeedsSemi = false;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (text.startsWith('//', i)) {
      const e = text.indexOf('\n', i);
      i = e < 0 ? n : e;
    } else if (text.startsWith('/*', i)) {
      const e = text.indexOf('*/', i + 2);
      const body = text.slice(i, e < 0 ? n : e);
      if (body.includes('\n') && lastNeedsSemi) {
        push({ v: ';', k: 'p' });
        lastNeedsSemi = false;
      }
      i = e < 0 ? n : e + 2;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      push({ v: text.slice(i, j + 1), k: 'str', str: JSON.parse(text.slice(i, j + 1)) });
      lastNeedsSemi = true;
      i = j + 1;
    } else if (c === '`') {
      const j = text.indexOf('`', i + 1);
      push({ v: text.slice(i, j + 1), k: 'str', str: text.slice(i + 1, j) });
      lastNeedsSemi = true;
      i = j + 1;
    } else if (/[A-Za-z_\u0080-\uffff]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_\u0080-\uffff]/.test(text[j])) j++;
      push({ v: text.slice(i, j), k: 'id' });
      lastNeedsSemi = true;
      i = j;
    } else {
      push({ v: c, k: 'p' });
      lastNeedsSemi = c === ')' || c === ']' || c === '}';
      i++;
      // past the imports nothing else is needed
      if (c === '{' || c === '=') break;
    }
  }
  return toks;
}

/** Evaluates a //go:build expression. */
function evalConstraint(expr, has) {
  const toks = expr.match(/\(|\)|!|&&|\|\||[^\s()!&|]+/g) ?? [];
  let i = 0;
  const or = () => {
    let v = and();
    while (toks[i] === '||') {
      i++;
      v = and() || v;
    }
    return v;
  };
  const and = () => {
    let v = not();
    while (toks[i] === '&&') {
      i++;
      v = not() && v;
    }
    return v;
  };
  const not = () => {
    const t = toks[i++];
    if (t === '!') return !not();
    if (t === '(') {
      const v = or();
      if (toks[i++] !== ')') throw new GoError(`invalid //go:build line: ${expr}`);
      return v;
    }
    if (!t || !/^[A-Za-z0-9_.]+$/.test(t)) throw new GoError(`invalid //go:build line: ${expr}`);
    return has(t);
  };
  const v = or();
  if (i !== toks.length) throw new GoError(`invalid //go:build line: ${expr}`);
  return v;
}

/** One // +build line: space-separated OR of comma-separated AND of [!]tag. */
function evalPlusBuild(line, has) {
  return line.split(/\s+/).some((term) => term.split(',').every((t) => (t.startsWith('!') ? !has(t.slice(1)) : has(t))));
}

// ---------------------------------------------------------------------- zip

async function inflate(data) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new GoError('go: module zip: no end of central directory');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new GoError('go: module zip: bad central directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = TD.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const lnlen = dv.getUint16(off + 26, true);
    const lelen = dv.getUint16(off + 28, true);
    const start = off + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw);
    else throw new GoError(`go: module zip: ${name}: compression method ${method}`);
    if (data.length !== usize) throw new GoError(`go: module zip: ${name}: size mismatch`);
    files.push({ name, data });
  }
  return files;
}

// --------------------------------------------------------------------- main

export default async function main(ctx) {
  const d = new Driver(ctx);
  try {
    return await d.run(ctx.argv.slice(1));
  } catch (e) {
    if (e instanceof GoError) {
      if (e.message) await d.err(e.message.endsWith('\n') ? e.message : `${e.message}\n`);
      return e.code;
    }
    await d.err(`go: internal error: ${e?.stack ?? e}\n`);
    return 3;
  }
}
