# Link flags of the SLICC TLS engine, shared by the local and homescoop builds.
# An ES module factory (`export default async function(options)`), no
# filesystem, the wasm beside the glue (never inlined: a lazy chunk plus an
# asset, not a JS payload), usable in a page or a module worker (Node callers pass `wasmBinary`).
ENGINE_LINK_FLAGS=(
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createTlsEngine
  -sENVIRONMENT=web,worker
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=4MB -sSTACK_SIZE=256KB
  -sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 -sINCOMING_MODULE_JS_API=wasmBinary,locateFile
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]'
  '-sEXPORTED_FUNCTIONS=["_malloc","_free"]'
)
