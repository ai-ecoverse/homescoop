// Node runs the tool immediately. In the browser, slicc mounts OPFS_SYNC_FS
// and then calls Module.callMain itself.
// SLICC_PRELOAD and SLICC_EXPORT are comma-separated virt=host pairs so a
// Node run can move files between the host disk and the in-wasm filesystem.
// A host that calls main itself sets noInitialRun, as slicc-kernel's Node
// process worker does; then this runner stays out of it (homescoop#276).
if (typeof process !== 'undefined' && process.versions && process.versions.node && !Module['noInitialRun']) {
  var sliccPrevInit = Module['onRuntimeInitialized'];
  Module['onRuntimeInitialized'] = function sliccNodeMain() {
    if (sliccPrevInit) sliccPrevInit();
    var fs = require('node:fs');
    var path = require('node:path');
    function ensure(dir) {
      if (!dir || dir === '/') return;
      var parts = dir.split('/').filter(Boolean);
      var cur = '';
      for (var part of parts) {
        cur += '/' + part;
        try { FS.mkdir(cur); } catch (e) {}
      }
    }
    function eachPair(spec, fn) {
      if (!spec) return;
      for (var item of spec.split(',')) {
        if (!item) continue;
        var eq = item.indexOf('=');
        if (eq < 1) continue;
        fn(item.slice(0, eq), item.slice(eq + 1));
      }
    }
    function mountTree(virt, host) {
      ensure(virt);
      for (var name of fs.readdirSync(host)) {
        var h = path.join(host, name);
        var v = virt + '/' + name;
        var st = fs.statSync(h);
        if (st.isDirectory()) mountTree(v, h);
        else if (st.isFile()) FS.writeFile(v, fs.readFileSync(h));
      }
    }
    eachPair(process.env.SLICC_MOUNT, mountTree);
    eachPair(process.env.SLICC_PRELOAD, function(virt, host) {
      ensure(virt.lastIndexOf('/') <= 0 ? '/' : virt.slice(0, virt.lastIndexOf('/')));
      FS.writeFile(virt, fs.readFileSync(host));
    });
    if (process.env.SLICC_CHDIR) {
      ensure(process.env.SLICC_CHDIR);
      FS.chdir(process.env.SLICC_CHDIR);
    }
    var code = Module['callMain'](programArgs.slice());
    function exportDir(virt, host) {
      fs.mkdirSync(host, {recursive: true});
      for (var name of FS.readdir(virt)) {
        if (name === '.' || name === '..') continue;
        var p = virt + '/' + name;
        var st = FS.stat(p);
        if (FS.isDir(st.mode)) exportDir(p, path.join(host, name));
        else fs.writeFileSync(path.join(host, name), FS.readFile(p));
      }
    }
    eachPair(process.env.SLICC_EXPORT_DIR, exportDir);
    eachPair(process.env.SLICC_EXPORT, function(virt, host) {
      fs.mkdirSync(path.dirname(host), {recursive: true});
      fs.writeFileSync(host, FS.readFile(virt));
    });
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  };
}
