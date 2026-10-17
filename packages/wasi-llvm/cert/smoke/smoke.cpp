#include "lld/Common/Driver.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Target/TargetMachine.h"
#include "llvm/Target/TargetOptions.h"
#include "llvm/TargetParser/Triple.h"
#include <cstdio>
#include <optional>

LLD_HAS_DRIVER(wasm)

using namespace llvm;

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: smoke <out.o> <out.wasm>\n");
    return 2;
  }
  LLVMInitializeWebAssemblyTargetInfo();
  LLVMInitializeWebAssemblyTarget();
  LLVMInitializeWebAssemblyTargetMC();
  LLVMInitializeWebAssemblyAsmPrinter();

  LLVMContext ctx;
  Module mod("smoke", ctx);
  Triple triple("wasm32-unknown-unknown");
  mod.setTargetTriple(triple);
  IRBuilder<> b(ctx);
  auto *i32 = b.getInt32Ty();
  auto *fn = Function::Create(FunctionType::get(i32, {i32, i32}, false), Function::ExternalLinkage, "add", mod);
  b.SetInsertPoint(BasicBlock::Create(ctx, "entry", fn));
  b.CreateRet(b.CreateAdd(fn->getArg(0), fn->getArg(1)));
  if (verifyModule(mod, &errs())) return 3;
  mod.print(outs(), nullptr);

  std::string err;
  const Target *target = TargetRegistry::lookupTarget(triple.str(), err);
  if (!target) {
    errs() << "lookupTarget: " << err << "\n";
    return 4;
  }
  TargetMachine *tm = target->createTargetMachine(triple, "generic", "", TargetOptions(), std::nullopt);
  mod.setDataLayout(tm->createDataLayout());
  std::error_code ec;
  {
    raw_fd_ostream obj(argv[1], ec, sys::fs::OF_None);
    if (ec) {
      errs() << argv[1] << ": " << ec.message() << "\n";
      return 5;
    }
    legacy::PassManager pm;
    if (tm->addPassesToEmitFile(pm, obj, nullptr, CodeGenFileType::ObjectFile)) return 6;
    pm.run(mod);
  }
  outs() << "object " << argv[1] << "\n";

  const char *args[] = {"wasm-ld", "--threads=1", "--no-entry", "--export=add", "-o", argv[2], argv[1]};
  lld::Result r = lld::lldMain(args, outs(), errs(), {{lld::Wasm, &lld::wasm::link}});
  if (r.retCode) return 7;
  outs() << "linked " << argv[2] << "\n";
  return 0;
}
