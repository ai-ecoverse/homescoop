[Skip to content](#apicontent)

[Node.js](/ "Go back to the home page")

* * *

- [About this documentation](documentation.html)
- [Usage and example](synopsis.html)
- [Assertion testing](assert.html)
- [Asynchronous context tracking](async_context.html)
- [Async hooks](async_hooks.html)
- [Benchmark runner](bench.html)
- [Buffer](buffer.html)
- [C++ addons](addons.html)
- [C/C++ addons with Node-API](n-api.html)
- [C++ embedder API](embedding.html)
- [Child processes](child_process.html)
- [Cluster](cluster.html)
- [Command-line options](cli.html)
- [Console](console.html)
- [Crypto](crypto.html)
- [Debugger](debugger.html)
- [Deprecated APIs](deprecations.html)
- [Diagnostics Channel](diagnostics_channel.html)
- [DNS](dns.html)
- [Domain](domain.html)
- [Environment Variables](environment_variables.html)
- [Errors](errors.html)
- [Events](events.html)
- [File system](fs.html)
- [FFI](ffi.html)
- [Globals](globals.html)
- [HTTP](http.html)
- [HTTP/2](http2.html)
- [HTTPS](https.html)
- [Inspector](inspector.html)
- [Internationalization](intl.html)
- [Iterable Streams API](stream_iter.html)
- [Modules: CommonJS modules](modules.html)
- [Modules: ECMAScript modules](esm.html)
- [Modules: `node:module` API](module.html)
- [Modules: Packages](packages.html)
- [Modules: TypeScript](typescript.html)
- [Net](net.html)
- [OS](os.html)
- [Path](path.html)
- [Performance hooks](perf_hooks.html)
- [Permissions](permissions.html)
- [Process](process.html)
- [Punycode](punycode.html)
- [Query strings](querystring.html)
- [Readline](readline.html)
- [REPL](repl.html)
- [Report](report.html)
- [Single executable applications](single-executable-applications.html)
- [SQLite](sqlite.html)
- [Stream](stream.html)
- [String decoder](string_decoder.html)
- [Test runner](test.html)
- [Timers](timers.html)
- [TLS/SSL](tls.html)
- [Trace events](tracing.html)
- [TTY](tty.html)
- [UDP/datagram](dgram.html)
- [URL](url.html)
- [Utilities](util.html)
- [V8](v8.html)
- [Virtual File System](vfs.html)
- [VM](vm.html)
- [WASI](wasi.html)
- [Web Crypto API](webcrypto.html)
- [Web Streams API](webstreams.html)
- [Worker threads](worker_threads.html)
- [Zlib](zlib.html)

* * *

- [Code repository and issue tracker](https://github.com/nodejs/node)

# Node.js v26.12.1 documentation

- Node.js v26.12.1
- [Table of contents](#toc-picker)
  
  - [TTY](tty.html#tty)
    
    - [Class: `tty.ReadStream`](tty.html#class-ttyreadstream)
      
      - [`readStream.isRaw`](tty.html#readstreamisraw)
      - [`readStream.isTTY`](tty.html#readstreamistty)
      - [`readStream.setRawMode(mode)`](tty.html#readstreamsetrawmodemode)
      - [`readStream.rawMode`](tty.html#readstreamrawmode)
    - [Class: `tty.WriteStream`](tty.html#class-ttywritestream)
      
      - [`new tty.ReadStream(fd[, options])`](tty.html#new-ttyreadstreamfd-options)
      - [`new tty.WriteStream(fd)`](tty.html#new-ttywritestreamfd)
      - [Event: `'resize'`](tty.html#event-resize)
      - [`writeStream.clearLine(dir[, callback])`](tty.html#writestreamclearlinedir-callback)
      - [`writeStream.clearScreenDown([callback])`](tty.html#writestreamclearscreendowncallback)
      - [`writeStream.columns`](tty.html#writestreamcolumns)
      - [`writeStream.cursorTo(x[, y][, callback])`](tty.html#writestreamcursortox-y-callback)
      - [`writeStream.getColorDepth([env])`](tty.html#writestreamgetcolordepthenv)
      - [`writeStream.getWindowSize()`](tty.html#writestreamgetwindowsize)
      - [`writeStream.hasColors([count][, env])`](tty.html#writestreamhascolorscount-env)
      - [`writeStream.isTTY`](tty.html#writestreamistty)
      - [`writeStream.moveCursor(dx, dy[, callback])`](tty.html#writestreammovecursordx-dy-callback)
      - [`writeStream.rows`](tty.html#writestreamrows)
    - [`tty.isatty(fd)`](tty.html#ttyisattyfd)
- [Index](#gtoc-picker)
  
  - [Index](index.html)
  
  * * *
  
  - [About this documentation](documentation.html)
  - [Usage and example](synopsis.html)
  - [Assertion testing](assert.html)
  - [Asynchronous context tracking](async_context.html)
  - [Async hooks](async_hooks.html)
  - [Benchmark runner](bench.html)
  - [Buffer](buffer.html)
  - [C++ addons](addons.html)
  - [C/C++ addons with Node-API](n-api.html)
  - [C++ embedder API](embedding.html)
  - [Child processes](child_process.html)
  - [Cluster](cluster.html)
  - [Command-line options](cli.html)
  - [Console](console.html)
  - [Crypto](crypto.html)
  - [Debugger](debugger.html)
  - [Deprecated APIs](deprecations.html)
  - [Diagnostics Channel](diagnostics_channel.html)
  - [DNS](dns.html)
  - [Domain](domain.html)
  - [Environment Variables](environment_variables.html)
  - [Errors](errors.html)
  - [Events](events.html)
  - [File system](fs.html)
  - [FFI](ffi.html)
  - [Globals](globals.html)
  - [HTTP](http.html)
  - [HTTP/2](http2.html)
  - [HTTPS](https.html)
  - [Inspector](inspector.html)
  - [Internationalization](intl.html)
  - [Iterable Streams API](stream_iter.html)
  - [Modules: CommonJS modules](modules.html)
  - [Modules: ECMAScript modules](esm.html)
  - [Modules: `node:module` API](module.html)
  - [Modules: Packages](packages.html)
  - [Modules: TypeScript](typescript.html)
  - [Net](net.html)
  - [OS](os.html)
  - [Path](path.html)
  - [Performance hooks](perf_hooks.html)
  - [Permissions](permissions.html)
  - [Process](process.html)
  - [Punycode](punycode.html)
  - [Query strings](querystring.html)
  - [Readline](readline.html)
  - [REPL](repl.html)
  - [Report](report.html)
  - [Single executable applications](single-executable-applications.html)
  - [SQLite](sqlite.html)
  - [Stream](stream.html)
  - [String decoder](string_decoder.html)
  - [Test runner](test.html)
  - [Timers](timers.html)
  - [TLS/SSL](tls.html)
  - [Trace events](tracing.html)
  - [TTY](tty.html)
  - [UDP/datagram](dgram.html)
  - [URL](url.html)
  - [Utilities](util.html)
  - [V8](v8.html)
  - [Virtual File System](vfs.html)
  - [VM](vm.html)
  - [WASI](wasi.html)
  - [Web Crypto API](webcrypto.html)
  - [Web Streams API](webstreams.html)
  - [Worker threads](worker_threads.html)
  - [Zlib](zlib.html)
- [Other versions](#alt-docs)
  
  01. [26.x](https://nodejs.org/docs/latest-v26.x/api/tty.html)
  02. [25.x](https://nodejs.org/docs/latest-v25.x/api/tty.html)
  03. [24.x **LTS**](https://nodejs.org/docs/latest-v24.x/api/tty.html)
  04. [23.x](https://nodejs.org/docs/latest-v23.x/api/tty.html)
  05. [22.x **LTS**](https://nodejs.org/docs/latest-v22.x/api/tty.html)
  06. [21.x](https://nodejs.org/docs/latest-v21.x/api/tty.html)
  07. [20.x](https://nodejs.org/docs/latest-v20.x/api/tty.html)
  08. [19.x](https://nodejs.org/docs/latest-v19.x/api/tty.html)
  09. [18.x](https://nodejs.org/docs/latest-v18.x/api/tty.html)
  10. [17.x](https://nodejs.org/docs/latest-v17.x/api/tty.html)
  11. [16.x](https://nodejs.org/docs/latest-v16.x/api/tty.html)
  12. [15.x](https://nodejs.org/docs/latest-v15.x/api/tty.html)
  13. [14.x](https://nodejs.org/docs/latest-v14.x/api/tty.html)
  14. [13.x](https://nodejs.org/docs/latest-v13.x/api/tty.html)
  15. [12.x](https://nodejs.org/docs/latest-v12.x/api/tty.html)
  16. [11.x](https://nodejs.org/docs/latest-v11.x/api/tty.html)
  17. [10.x](https://nodejs.org/docs/latest-v10.x/api/tty.html)
  18. [9.x](https://nodejs.org/docs/latest-v9.x/api/tty.html)
  19. [8.x](https://nodejs.org/docs/latest-v8.x/api/tty.html)
  20. [7.x](https://nodejs.org/docs/latest-v7.x/api/tty.html)
  21. [6.x](https://nodejs.org/docs/latest-v6.x/api/tty.html)
  22. [5.x](https://nodejs.org/docs/latest-v5.x/api/tty.html)
  23. [4.x](https://nodejs.org/docs/latest-v4.x/api/tty.html)
  24. [0.12.x](https://nodejs.org/docs/latest-v0.12.x/api/tty.html)
  25. [0.10.x](https://nodejs.org/docs/latest-v0.10.x/api/tty.html)
- [Options](#options-picker)
  
  - [View on single page](all.html)
  - [View as JSON](tty.json)
  - [Edit on GitHub](https://github.com/nodejs/node/edit/main/doc/api/tty.md)

* * *

Table of contents

- [TTY](tty.html#tty)
  
  - [Class: `tty.ReadStream`](tty.html#class-ttyreadstream)
    
    - [`readStream.isRaw`](tty.html#readstreamisraw)
    - [`readStream.isTTY`](tty.html#readstreamistty)
    - [`readStream.setRawMode(mode)`](tty.html#readstreamsetrawmodemode)
    - [`readStream.rawMode`](tty.html#readstreamrawmode)
  - [Class: `tty.WriteStream`](tty.html#class-ttywritestream)
    
    - [`new tty.ReadStream(fd[, options])`](tty.html#new-ttyreadstreamfd-options)
    - [`new tty.WriteStream(fd)`](tty.html#new-ttywritestreamfd)
    - [Event: `'resize'`](tty.html#event-resize)
    - [`writeStream.clearLine(dir[, callback])`](tty.html#writestreamclearlinedir-callback)
    - [`writeStream.clearScreenDown([callback])`](tty.html#writestreamclearscreendowncallback)
    - [`writeStream.columns`](tty.html#writestreamcolumns)
    - [`writeStream.cursorTo(x[, y][, callback])`](tty.html#writestreamcursortox-y-callback)
    - [`writeStream.getColorDepth([env])`](tty.html#writestreamgetcolordepthenv)
    - [`writeStream.getWindowSize()`](tty.html#writestreamgetwindowsize)
    - [`writeStream.hasColors([count][, env])`](tty.html#writestreamhascolorscount-env)
    - [`writeStream.isTTY`](tty.html#writestreamistty)
    - [`writeStream.moveCursor(dx, dy[, callback])`](tty.html#writestreammovecursordx-dy-callback)
    - [`writeStream.rows`](tty.html#writestreamrows)
  - [`tty.isatty(fd)`](tty.html#ttyisattyfd)

## TTY[]()[#](#tty)

**Source Code:** [lib/tty.js](https://github.com/nodejs/node/blob/main/lib/tty.js)

[Stability: 2](documentation.html#stability-index) - Stable

The `node:tty` module provides the `tty.ReadStream` and `tty.WriteStream` classes. In most cases, it will not be necessary or possible to use this module directly. However, it can be accessed using:

```js
const tty = require('node:tty');

jscopy
```

When Node.js detects that it is being run with a text terminal ("TTY") attached, [`process.stdin`](process.html#processstdin) will, by default, be initialized as an instance of `tty.ReadStream` and both [`process.stdout`](process.html#processstdout) and [`process.stderr`](process.html#processstderr) will, by default, be instances of `tty.WriteStream`. The preferred method of determining whether Node.js is being run within a TTY context is to check that the value of the `process.stdout.isTTY` property is `true`:

```console
$ node -p -e "Boolean(process.stdout.isTTY)"
true
$ node -p -e "Boolean(process.stdout.isTTY)" | cat
false

consolecopy
```

In most cases, there should be little to no reason for an application to manually create instances of the `tty.ReadStream` and `tty.WriteStream` classes.

### Class: `tty.ReadStream`[]()[#](#class-ttyreadstream)

Added in: v0.5.8

- Extends: [`<net.Socket>`](net.html#class-netsocket)

Represents the readable side of a TTY. In normal circumstances [`process.stdin`](process.html#processstdin) will be the only `tty.ReadStream` instance in a Node.js process and there should be no reason to create additional instances.

#### `readStream.isRaw`[]()[#](#readstreamisraw)

Added in: v0.7.7

A `boolean` that is `true` if the TTY is currently configured to operate as a raw device.

This flag is always `false` when a process starts, even if the terminal is operating in raw mode. Its value will change with subsequent calls to `setRawMode`.

#### `readStream.isTTY`[]()[#](#readstreamistty)

Added in: v0.5.8

A `boolean` that is always `true` for `tty.ReadStream` instances.

#### `readStream.setRawMode(mode)`[]()[#](#readstreamsetrawmodemode)

Added in: v0.7.7

History

VersionChangesv26.8.0

The `mode` argument supports `'raw'` and `'io'`.

- `mode` [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type) If `true` or `'raw'`, configures the `tty.ReadStream` to operate as a raw device. If `'io'`, configures the `tty.ReadStream` to operate in binary-safe I/O mode. If `false`, configures the `tty.ReadStream` to operate in its default mode. The `readStream.isRaw` property will be set to whether the stream is in raw mode, and the `readStream.rawMode` property will be set to the resulting mode.
- Returns: [`<this>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Operators/this) The read stream instance.

Allows configuration of `tty.ReadStream` so that it operates as a raw device.

When in raw mode, input is always available character-by-character, not including modifiers. Additionally, all special processing of input characters by the terminal is disabled, including echoing input characters. `Ctrl`+`C` will no longer cause a `SIGINT` when in this mode. This mode does not affect terminal output processing, such as newline translation on Unix terminals.

On Windows, `setRawMode()` requires write permission to the console input buffer. When opening `"\\\\.\\CONIN$"` with the [`fs.open()`](fs.html#fsopenpath-flags-mode-callback) family of APIs (for passing into `new tty.ReadStream()`), be sure to use a read/write flag such as `'r+'`.

When in binary-safe I/O mode, terminal output processing is also disabled. This corresponds to libuv's `UV_TTY_MODE_IO` mode and is not supported on Windows.

#### `readStream.rawMode`[]()[#](#readstreamrawmode)

Added in: v26.8.0

- [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) | [`<string>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#string_type)

The current raw mode for the `tty.ReadStream`. This is `false` when the stream is in its default mode, `'raw'` when raw input mode is enabled, and `'io'` when binary-safe I/O mode is enabled.

### Class: `tty.WriteStream`[]()[#](#class-ttywritestream)

Added in: v0.5.8

- Extends: [`<net.Socket>`](net.html#class-netsocket)

Represents the writable side of a TTY. In normal circumstances, [`process.stdout`](process.html#processstdout) and [`process.stderr`](process.html#processstderr) will be the only `tty.WriteStream` instances created for a Node.js process and there should be no reason to create additional instances.

#### `new tty.ReadStream(fd[, options])`[]()[#](#new-ttyreadstreamfd-options)

Added in: v0.5.8

History

VersionChangesv0.9.4

The `options` argument is supported.

- `fd` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A file descriptor associated with a TTY.
- `options` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) Options passed to parent `net.Socket`, see `options` of [`net.Socket` constructor](net.html#new-netsocketoptions).
- Returns: [`<tty.ReadStream>`](tty.html#class-ttyreadstream)

Creates a `ReadStream` for `fd` associated with a TTY.

#### `new tty.WriteStream(fd)`[]()[#](#new-ttywritestreamfd)

Added in: v0.5.8

- `fd` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A file descriptor associated with a TTY.
- Returns: [`<tty.WriteStream>`](tty.html#class-ttywritestream)

Creates a `WriteStream` for `fd` associated with a TTY.

#### Event: `'resize'`[]()[#](#event-resize)

Added in: v0.7.7

The `'resize'` event is emitted whenever either of the `writeStream.columns` or `writeStream.rows` properties have changed. No arguments are passed to the listener callback when called.

```js
process.stdout.on('resize', () => {
  console.log('screen size has changed!');
  console.log(`${process.stdout.columns}x${process.stdout.rows}`);
});

jscopy
```

#### `writeStream.clearLine(dir[, callback])`[]()[#](#writestreamclearlinedir-callback)

Added in: v0.7.7

History

VersionChangesv12.7.0

The stream's write() callback and return value are exposed.

- `dir` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
  
  - `-1`: to the left from cursor
  - `1`: to the right from cursor
  - `0`: the entire line
- `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) Invoked once the operation completes.
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) `false` if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data; otherwise `true`.

`writeStream.clearLine()` clears the current line of this `WriteStream` in a direction identified by `dir`.

#### `writeStream.clearScreenDown([callback])`[]()[#](#writestreamclearscreendowncallback)

Added in: v0.7.7

History

VersionChangesv12.7.0

The stream's write() callback and return value are exposed.

- `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) Invoked once the operation completes.
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) `false` if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data; otherwise `true`.

`writeStream.clearScreenDown()` clears this `WriteStream` from the current cursor down.

#### `writeStream.columns`[]()[#](#writestreamcolumns)

Added in: v0.7.7

A `number` specifying the number of columns the TTY currently has. This property is updated whenever the `'resize'` event is emitted.

#### `writeStream.cursorTo(x[, y][, callback])`[]()[#](#writestreamcursortox-y-callback)

Added in: v0.7.7

History

VersionChangesv12.7.0

The stream's write() callback and return value are exposed.

- `x` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
- `y` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
- `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) Invoked once the operation completes.
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) `false` if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data; otherwise `true`.

`writeStream.cursorTo()` moves this `WriteStream`'s cursor to the specified position.

#### `writeStream.getColorDepth([env])`[]()[#](#writestreamgetcolordepthenv)

Added in: v9.9.0

- `env` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) An object containing the environment variables to check. This enables simulating the usage of a specific terminal. **Default:** `process.env`.
- Returns: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)

Returns:

- `1` for 2,
- `4` for 16,
- `8` for 256,
- `24` for 16,777,216 colors supported.

Use this to determine what colors the terminal supports. Due to the nature of colors in terminals it is possible to either have false positives or false negatives. It depends on process information and the environment variables that may lie about what terminal is used. It is possible to pass in an `env` object to simulate the usage of a specific terminal. This can be useful to check how specific environment settings behave.

To enforce a specific color support, use one of the below environment settings.

- 2 colors: `FORCE_COLOR = 0` (Disables colors)
- 16 colors: `FORCE_COLOR = 1`
- 256 colors: `FORCE_COLOR = 2`
- 16,777,216 colors: `FORCE_COLOR = 3`

Disabling color support is also possible by using the `NO_COLOR` and `NODE_DISABLE_COLORS` environment variables.

#### `writeStream.getWindowSize()`[]()[#](#writestreamgetwindowsize)

Added in: v0.7.7

- Returns: [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)\[]

`writeStream.getWindowSize()` returns the size of the TTY corresponding to this `WriteStream`. The array is of the type `[numColumns, numRows]` where `numColumns` and `numRows` represent the number of columns and rows in the corresponding TTY.

#### `writeStream.hasColors([count][, env])`[]()[#](#writestreamhascolorscount-env)

Added in: v11.13.0, v10.16.0

- `count` [`<integer>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) The number of colors that are requested (minimum 2). **Default:** 16.
- `env` [`<Object>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) An object containing the environment variables to check. This enables simulating the usage of a specific terminal. **Default:** `process.env`.
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

Returns `true` if the `writeStream` supports at least as many colors as provided in `count`. Minimum support is 2 (black and white).

This has the same false positives and negatives as described in [`writeStream.getColorDepth()`](#writestreamgetcolordepthenv).

```js
process.stdout.hasColors();
// Returns true or false depending on if `stdout` supports at least 16 colors.
process.stdout.hasColors(256);
// Returns true or false depending on if `stdout` supports at least 256 colors.
process.stdout.hasColors({ TMUX: '1' });
// Returns true.
process.stdout.hasColors(2 ** 24, { TMUX: '1' });
// Returns false (the environment setting pretends to support 2 ** 8 colors).

jscopy
```

#### `writeStream.isTTY`[]()[#](#writestreamistty)

Added in: v0.5.8

A `boolean` that is always `true`.

#### `writeStream.moveCursor(dx, dy[, callback])`[]()[#](#writestreammovecursordx-dy-callback)

Added in: v0.7.7

History

VersionChangesv12.7.0

The stream's write() callback and return value are exposed.

- `dx` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
- `dy` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type)
- `callback` [`<Function>`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Function) Invoked once the operation completes.
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type) `false` if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data; otherwise `true`.

`writeStream.moveCursor()` moves this `WriteStream`'s cursor *relative* to its current position.

#### `writeStream.rows`[]()[#](#writestreamrows)

Added in: v0.7.7

A `number` specifying the number of rows the TTY currently has. This property is updated whenever the `'resize'` event is emitted.

### `tty.isatty(fd)`[]()[#](#ttyisattyfd)

Added in: v0.5.8

- `fd` [`<number>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#number_type) A numeric file descriptor
- Returns: [`<boolean>`](https://developer.mozilla.org/docs/Web/JavaScript/Data_structures#boolean_type)

The `tty.isatty()` method returns `true` if the given `fd` is associated with a TTY and `false` if it is not, including whenever `fd` is not a non-negative integer.
