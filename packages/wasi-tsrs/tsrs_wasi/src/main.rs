use tsrs_execute::{execute, sys, tsc};

fn main() {
    if let Ok(pwd) = std::env::var("PWD") {
        let _ = std::env::set_current_dir(pwd);
    }
    tsrs_compiler::worker_pool();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sys: &'static sys::OsSys = Box::leak(Box::new(sys::new_system()));
    let result = execute::command_line(sys, args);
    tsc::System::flush(sys);
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let _ = std::io::Write::flush(&mut std::io::stderr());
    std::process::exit(result.status as i32)
}
