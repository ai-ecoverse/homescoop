// One wasm module for every LLVM tool wasm-clang ships (the LLVM_TOOL_LLVM_DRIVER_BUILD
// idea, linked from the per-tool objects): each tool's generated `<tool>-driver.cpp`
// main is left out and this main picks the tool by argv[0]. The tools share one copy
// of LLVM instead of one each (clang + lld alone: 104.6 MB → 73.7 MB).
//
// argv[0] is the command name (slicc.commands `argv0`, or the alias glue file name).
// `llvm <tool> args…` runs a tool by name too.
//
// Each tool initializes LLVM as its own generated driver does (build.sh checks the
// table against them): clang's sets up POSIX-utility signal handling and the
// SIGPIPE exit handler. Under default InitLLVM, clang -fsyntax-only / -c corrupted
// memory and trapped in llvm_shutdown() at exit.
#include "llvm/Support/InitLLVM.h"
#include "llvm/Support/LLVMDriver.h"
#include <cstdio>
#include <cstring>
#include <string>

int clang_main(int, char **, const llvm::ToolContext &);
int lld_main(int, char **, const llvm::ToolContext &);
int llvm_ar_main(int, char **, const llvm::ToolContext &);
int llvm_nm_main(int, char **, const llvm::ToolContext &);
int llvm_objcopy_main(int, char **, const llvm::ToolContext &);
int llvm_symbolizer_main(int, char **, const llvm::ToolContext &);

using ToolMain = int (*)(int, char **, const llvm::ToolContext &);

namespace {

struct Tool {
  const char *name;
  ToolMain main;
  // InitLLVM with InstallPipeSignalExitHandler and NeedsPOSIXUtilitySignalHandling.
  bool posixUtility = false;
};

// Each tool reads argv[0] again to pick its mode (clang++, ranlib, strip, wasm-ld…).
const Tool TOOLS[] = {
    {"clang", clang_main, true},
    {"clang++", clang_main, true},
    {"clang-cpp", clang_main, true},
    {"clang-cl", clang_main, true},
    {"lld", lld_main},
    {"wasm-ld", lld_main},
    {"ld.lld", lld_main},
    {"ld64.lld", lld_main},
    {"lld-link", lld_main},
    {"llvm-ar", llvm_ar_main},
    {"ar", llvm_ar_main},
    {"llvm-ranlib", llvm_ar_main},
    {"ranlib", llvm_ar_main},
    {"llvm-lib", llvm_ar_main},
    {"llvm-dlltool", llvm_ar_main},
    {"llvm-nm", llvm_nm_main},
    {"nm", llvm_nm_main},
    {"llvm-objcopy", llvm_objcopy_main},
    {"objcopy", llvm_objcopy_main},
    {"llvm-strip", llvm_objcopy_main},
    {"strip", llvm_objcopy_main},
    {"llvm-symbolizer", llvm_symbolizer_main},
    {"llvm-addr2line", llvm_symbolizer_main},
    {"addr2line", llvm_symbolizer_main},
};

// "…/bin/clang++-24.js" → "clang++": the base name without a script or wasm
// extension and without a trailing version.
std::string toolName(const char *argv0) {
  const char *slash = strrchr(argv0, '/');
  std::string name = slash ? slash + 1 : argv0;
  for (const char *ext : {".js", ".wasm", ".exe"}) {
    size_t n = strlen(ext);
    if (name.size() > n && name.compare(name.size() - n, n, ext) == 0)
      name.resize(name.size() - n);
  }
  size_t dash = name.find_last_of('-');
  if (dash != std::string::npos && dash + 1 < name.size() &&
      name.find_first_not_of("0123456789.", dash + 1) == std::string::npos)
    name.resize(dash);
  return name;
}

const Tool *find(const std::string &name) {
  for (const Tool &tool : TOOLS)
    if (name == tool.name)
      return &tool;
  // A target-prefixed name, as clang itself accepts it (wasm32-wasi-clang++).
  for (const char *suffix : {"-clang", "-clang++"}) {
    size_t n = strlen(suffix);
    if (name.size() > n && name.compare(name.size() - n, n, suffix) == 0)
      return &TOOLS[0];
  }
  return nullptr;
}

int usage(const char *argv0) {
  fprintf(stderr, "%s: unknown LLVM tool; run it as one of:", argv0);
  for (const Tool &tool : TOOLS)
    fprintf(stderr, " %s", tool.name);
  fprintf(stderr, "\n(or: llvm <tool> [args...])\n");
  return 1;
}

} // namespace

int main(int argc, char **argv) {
  std::string name = toolName(argv[0]);
  if (name == "llvm") {
    if (argc < 2)
      return usage(argv[0]);
    ++argv;
    --argc;
    name = toolName(argv[0]);
  }
  const Tool *tool = find(name);
  if (!tool)
    return usage(argv[0]);
  llvm::InitLLVM X(argc, argv, tool->posixUtility, tool->posixUtility);
  return tool->main(argc, argv, {argv[0], nullptr, false});
}
