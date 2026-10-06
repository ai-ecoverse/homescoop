/* Force-link slicc spawn/wait into tools that never call them (llvm-ar, …).
 * Emscripten's metadce otherwise drops the EM_JS that references Module.sliccKernel. */
#include <emscripten.h>

int slicc_spawn_capture(const char *file, char *const *argv, char *const *envp, const char *cwd,
                        int in_fd, int out_fd, int err_fd);

/* Real call (unreachable) so the linker and metadce keep the EM_JS import. */
EMSCRIPTEN_KEEPALIVE int homescoop_keep_slicc_spawn(void) {
  if (emscripten_random() > 2.0) {
    return slicc_spawn_capture("", 0, 0, 0, -1, -1, -1);
  }
  return 0;
}
