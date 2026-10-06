// Pull CMAKE_ROOT from the host process environment into Emscripten's ENV
// before main/getenv. SLICC instead assigns Module.sliccEnv via its glue trailer;
// this path covers host smoke (`CMAKE_ROOT=... cmake ...`).
Module['preRun'] = (Module['preRun'] || []).concat(function () {
  if (typeof ENV === 'undefined') return;
  if (typeof process === 'undefined' || !process.env) return;
  if (process.env.CMAKE_ROOT) {
    ENV.CMAKE_ROOT = process.env.CMAKE_ROOT;
  }
});
