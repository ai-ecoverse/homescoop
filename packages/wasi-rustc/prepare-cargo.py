#!/usr/bin/env python3
"""Apply the SLICC WASIX process bridge to the pinned Cargo 0.84 fork."""
from pathlib import Path
import re
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

# Stock wasm32-wasip1 std reports `/` as current_dir even when the WASIX host
# starts the process elsewhere. Bash and the spawn bridge carry the actual cwd
# in PWD, so use that for Cargo's global context when it is a real directory.
path = source / "src/cargo/util/context/mod.rs"
text = path.read_text()
old = """        let cwd =
            env::current_dir().context("couldn't get the current directory of the process")?;"""
if text.count(old) != 2:
    raise RuntimeError("Cargo GlobalContext cwd spans changed")
new = """        let cwd =
            cargo_current_dir().context("couldn't get the current directory of the process")?;"""
text = text.replace(old, new)
marker = "use self::ConfigValue as CV;"
helper = """#[cfg(all(target_os = "wasi", target_env = "p1"))]
fn cargo_current_dir() -> std::io::Result<PathBuf> {
    if let Some(pwd) = env::var_os("PWD") {
        let path = PathBuf::from(pwd);
        if path.is_absolute() && path.is_dir() {
            return Ok(path);
        }
    }
    env::current_dir()
}

#[cfg(not(all(target_os = "wasi", target_env = "p1")))]
fn cargo_current_dir() -> std::io::Result<PathBuf> {
    env::current_dir()
}

"""
if text.count(marker) != 1:
    raise RuntimeError("Cargo GlobalContext imports changed")
path.write_text(text.replace(marker, helper + marker))

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
# This fork contains unconditional diagnostic println! calls in core build
# paths. They corrupt cargo metadata and --message-format=json stdout. Remove
# only the known single-line diagnostics from the pinned source revision.
for rel, expected in {
    "crates/jobserver/src/wasi.rs": 27,
    "crates/cargo-util/src/paths.rs": 17,
    "src/cargo/ops/cargo_compile/mod.rs": 2,
    "src/cargo/core/compiler/layout.rs": 13,
    "src/cargo/core/compiler/build_runner/mod.rs": 35,
    "src/cargo/util/context/mod.rs": 6,
}.items():
    path = source / rel
    cleaned, count = re.subn(r"^[ \t]*println!\([^\n]*\);\n", "", path.read_text(), flags=re.MULTILINE)
    if count != expected:
        raise RuntimeError(f"{rel}: expected {expected} debug prints, found {count}")
    path.write_text(cleaned)

print("Prepared Cargo WASI process bridge (offline mode)")
