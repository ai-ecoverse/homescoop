/* homescoop -36 (homescoop#1059): sigsetjmp/siglongjmp in the EH trees.
 * LLVM's wasm setjmp/longjmp lowering only rewrites calls to setjmp, so a
 * sigsetjmp() call site (an ordinary libc function here) never got its
 * __c_longjmp catch and every siglongjmp escaped to the host ("[object
 * WebAssembly.Exception]", exit 70), with or without a signal. <setjmp.h>
 * in the EH trees now makes sigsetjmp(env, save) a macro that records the
 * mask here and then calls setjmp(env) at the call site; siglongjmp puts the
 * saved mask back (pthread_sigmask, slicc.sigmask_set) and longjmps. The
 * jmp_buf_impl that __wasm_setjmp writes fits in __jb, so __fl/__ss are ours. */
#include <setjmp.h>
#include <signal.h>

int __homescoop_sigsetjmp_save(sigjmp_buf buf, int save)
{
	buf->__fl = save != 0;
	if (save) pthread_sigmask(SIG_BLOCK, 0, (sigset_t *)buf->__ss);
	return 0;
}

_Noreturn void siglongjmp(sigjmp_buf buf, int ret)
{
	if (buf->__fl) pthread_sigmask(SIG_SETMASK, (const sigset_t *)buf->__ss, 0);
	longjmp(buf, ret);
}
