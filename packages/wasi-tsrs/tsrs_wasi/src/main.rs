// tsrs as a WASI preview1 command (_start), for slicc-kernel: native tsrs's
// osSys (std::fs through tsrs_vfs::osvfs, the embedded lib.*.d.ts) on one
// thread. Upstream's crates/tsrs_wasm is the same driver over a JS host file
// system instead, with no _start.

use tsrs_execute::{execute, sys, tsc};

fn main() {
    // slicc-kernel starts a WASI process with wasi-libc's working directory at
    // / and the real one in PWD.
    if let Ok(pwd) = std::env::var("PWD") {
        let _ = std::env::set_current_dir(pwd);
    }
    // As crates/tsrs_wasm: the one-thread rayon pool must exist before any other
    // rayon use (tsrs_core::NO_THREADS is true on wasm32).
    tsrs_compiler::worker_pool();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sys: &'static sys::osSys = Box::leak(Box::new(sys::new_system()));
    let result = execute::command_line(sys, args);
    tsc::System::flush(sys);
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let _ = std::io::Write::flush(&mut std::io::stderr());
    std::process::exit(result.status as i32)
}
