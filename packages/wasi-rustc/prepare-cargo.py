#!/usr/bin/env python3
"""Apply the SLICC WASIX process bridge to the pinned Cargo 0.84 fork."""
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1]).resolve()
assets = Path(__file__).resolve().parent / "cargo"


def change(rel: str, old: str, new: str) -> None:
    path = source / rel
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{rel}: expected one matching span, found {count}")
    path.write_text(text.replace(old, new))


shutil.copytree(assets / "wasix-command", source / "crates/wasix-command", dirs_exist_ok=True)
change("Cargo.toml", 'rustc_runner = { path = "crates/rustc_runner" }',
       'wasix-command = { path = "crates/wasix-command" }')
change("Cargo.toml", "rustc_runner.workspace = true", "wasix-command.workspace = true")
change("crates/cargo-util/Cargo.toml", "rustc_runner.workspace = true", "wasix-command.workspace = true")
change("Cargo.toml", "capture_io.workspace = true\n", "")
change("crates/cargo-util/src/process_builder.rs", "use rustc_runner::TaskResult;\n", "")
change("crates/cargo-util/src/process_builder.rs",
       '        println!("called status");\n        println!("cmd: {:?}", self.build_command());\n\n', "")
change("crates/cargo-util/src/process_builder.rs",
       '        println!("called output");\n        println!("cmd: {:?}", self.build_command());\n\n', "")
change("crates/cargo-util/src/process_builder.rs",
       "    fn _status(&self) -> io::Result<ExitStatus> {\n",
       """    fn _status(&self) -> io::Result<ExitStatus> {
        #[cfg(all(target_os = "wasi", target_env = "p1"))]
        {
            let result = wasix_command::run(&self.build_command(), self.stdin.as_deref(), false)?;
            if result.code != 0 {
                return Err(io::Error::other(format!("child exited with status {}", result.code)));
            }
            return Ok(ExitStatus::default());
        }
""")
path = source / "crates/cargo-util/src/process_builder.rs"
text = path.read_text()
start = text.index('        #[cfg(all(target_os = "wasi", target_env = "p1"))]\n        {',
                   text.index('    fn _output(&self) -> io::Result<Output> {'))
end = text.index('        #[cfg(not(all(target_os = "wasi", target_env = "p1")))]', start)
text = text[:start] + '''        #[cfg(all(target_os = "wasi", target_env = "p1"))]
        {
            let result = wasix_command::run(&self.build_command(), self.stdin.as_deref(), true)?;
            if result.code != 0 {
                return Err(io::Error::other(format!(
                    "child exited with status {}: {}", result.code,
                    String::from_utf8_lossy(&result.stderr)
                )));
            }
            return Ok(Output {
                status: ExitStatus::default(),
                stdout: result.stdout,
                stderr: result.stderr,
            });
        }

''' + text[end:]
start = text.index('    #[cfg(all(target_os = "wasi", target_env = "p1"))]\n    pub fn exec_with_streaming(')
end = text.index('    /// Builds the command with an `@<path>` argfile', start)
text = text[:start] + '''    #[cfg(all(target_os = "wasi", target_env = "p1"))]
    pub fn exec_with_streaming(
        &self,
        on_stdout_line: &mut dyn FnMut(&str) -> Result<()>,
        on_stderr_line: &mut dyn FnMut(&str) -> Result<()>,
        capture_output: bool,
    ) -> Result<Output> {
        let result = wasix_command::run(&self.build_command(), self.stdin.as_deref(), true)
            .with_context(|| ProcessError::could_not_execute(self))?;
        for line in String::from_utf8_lossy(&result.stdout).lines() {
            on_stdout_line(line)?;
        }
        for line in String::from_utf8_lossy(&result.stderr).lines() {
            on_stderr_line(line)?;
        }
        if result.code != 0 {
            bail!("child exited with status {}: {}", result.code,
                String::from_utf8_lossy(&result.stderr));
        }
        Ok(Output {
            status: ExitStatus::default(),
            stdout: if capture_output { result.stdout } else { Vec::new() },
            stderr: if capture_output { result.stderr } else { Vec::new() },
        })
    }

''' + text[end:]
path.write_text(text)

path = source / "src/cargo/ops/cargo_run.rs"
text = path.read_text()
start = text.index('    #[cfg(all(target_os = "wasi", target_env = "p1"))] {',
                   text.index('    gctx.shell().status("Running", process.to_string())?;'))
end = text.index('\n}', start)
text = text[:start] + '''    #[cfg(all(target_os = "wasi", target_env = "p1"))] {
        process.exec()
    }''' + text[end:]
path.write_text(text)

# Offline builds cannot reach this code, but an unresolved private import makes
# the whole wasm module unloadable. Registry HTTP will get a separate proxy path.
path = source / "crates/fetch/lib.rs"
text = path.read_text()
start = text.index('pub fn fetch(')
text = text[:start] + '''pub fn fetch(_url: String, _method: &str, _headers: Vec<(String, String)>, _body: Vec<u8>) -> Result<Response> {
    Err(Error::Fetch(-1))
}
'''
text = text.replace('use std::{fs::File, io::Read as _};\nuse std::os::fd::FromRawFd as _;\n\n', '')
start = text.index('#[link(wasm_import_module = "extend_imports")]')
end = text.index('#[derive(Debug, thiserror::Error)]', start)
text = text[:start] + text[end:]
path.write_text(text)
print("Prepared Cargo WASI process bridge (offline mode)")
