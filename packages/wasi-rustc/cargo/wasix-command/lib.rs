//! A small Command adapter for WASI std targets running in a WASIX host.
//! It can be removed when the compiler's standard library supports WASIX processes.
use std::collections::BTreeMap;
use std::ffi::{CString, OsString};
use std::io;
use std::os::wasi::ffi::OsStrExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

#[link(wasm_import_module = "wasix_32v1")]
extern "C" {
    fn proc_spawn3(
        name: *const u8,
        name_len: u32,
        argv: *const *const u8,
        argc: u32,
        env: *const *const u8,
        envc: u32,
        ops: *const u8,
        op_count: u32,
        signal: u32,
        priority: u32,
        search: u32,
        path: *const u8,
        path_len: u32,
        pid: *mut u32,
    ) -> u16;
    fn proc_join(pid: *mut [u8; 8], flags: u32, status: *mut [u8; 6]) -> u16;
}

const FD_OP_SIZE: usize = 56;
const FD_OP_OPEN: u8 = 2;
const FD_OP_CHDIR: u8 = 3;
const OFLAGS_CREAT_TRUNC: u16 = 1 | 8;
const RIGHTS_FD_WRITE: u64 = 1 << 6;
static NEXT_OUTPUT: AtomicU32 = AtomicU32::new(1);

pub struct Output {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

fn invalid(text: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, text)
}

fn cstr(bytes: &[u8]) -> io::Result<CString> {
    CString::new(bytes).map_err(|_| invalid("NUL in command argument or environment"))
}

fn put_op(op: &mut [u8; FD_OP_SIZE], cmd: u8, fd: u32, path: &[u8], flags: u16, rights: u64) {
    op[0] = cmd;
    op[4..8].copy_from_slice(&fd.to_le_bytes());
    op[12..16].copy_from_slice(&(path.as_ptr() as u32).to_le_bytes());
    op[16..20].copy_from_slice(&(path.len() as u32).to_le_bytes());
    op[24..26].copy_from_slice(&flags.to_le_bytes());
    op[32..40].copy_from_slice(&rights.to_le_bytes());
}

/// Run any executable exposed by the host, preserving Command's argv, env and cwd.
/// Output is collected through files so a verbose compiler cannot block on a full pipe.
/// A nonzero exit status is retained in `code` for callers to report.
/// If `capture` is false, the child inherits stdout and stderr.
/// `input` is handed to the child as a regular file on fd 0 when present.
///
/// WASI std does not expose a constructor for `std::process::ExitStatus`, so
/// callers adapt `code` at their own boundary until the WASIX std migration.
#[allow(unsafe_code)]
pub fn run(cmd: &Command, input: Option<&[u8]>, capture: bool) -> io::Result<Output> {
    let name = cmd.get_program().as_bytes();
    let mut args = Vec::new();
    args.push(cstr(name)?);
    for arg in cmd.get_args() {
        args.push(cstr(arg.as_bytes())?);
    }
    let argv: Vec<_> = args.iter().map(|arg| arg.as_ptr().cast::<u8>()).collect();

    let mut env: BTreeMap<OsString, OsString> = std::env::vars_os().collect();
    for (key, value) in cmd.get_envs() {
        if let Some(value) = value {
            env.insert(key.to_os_string(), value.to_os_string());
        } else {
            env.remove(key);
        }
    }
    let path = env
        .get(&OsString::from("PATH"))
        .map(|p| p.as_bytes().to_vec())
        .unwrap_or_default();
    let mut env_strings = Vec::with_capacity(env.len());
    for (key, value) in env {
        let mut bytes = key.as_bytes().to_vec();
        bytes.push(b'=');
        bytes.extend_from_slice(value.as_bytes());
        env_strings.push(cstr(&bytes)?);
    }
    let envp: Vec<_> = env_strings
        .iter()
        .map(|entry| entry.as_ptr().cast::<u8>())
        .collect();

    let mut paths: Vec<PathBuf> = Vec::new();
    let mut ops: Vec<[u8; FD_OP_SIZE]> = Vec::new();
    if let Some(cwd) = cmd.get_current_dir() {
        let mut op = [0u8; FD_OP_SIZE];
        put_op(&mut op, FD_OP_CHDIR, 0, cwd.as_os_str().as_bytes(), 0, 0);
        ops.push(op);
    }
    let output_id = NEXT_OUTPUT.fetch_add(1, Ordering::Relaxed);
    let tmp = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let prefix = format!("wasix-command-{output_id}");
    let stdout_path = tmp.join(format!("{prefix}.out"));
    let stderr_path = tmp.join(format!("{prefix}.err"));
    let stdin_path = tmp.join(format!("{prefix}.in"));
    if capture {
        std::fs::write(&stdout_path, [])?;
        std::fs::write(&stderr_path, [])?;
        paths.push(stdout_path.clone());
        paths.push(stderr_path.clone());
    }
    if input.is_some() {
        paths.push(stdin_path.clone());
    }
    for (fd, p) in [(1, &stdout_path), (2, &stderr_path)] {
        if capture {
            let mut op = [0u8; FD_OP_SIZE];
            put_op(
                &mut op,
                FD_OP_OPEN,
                fd,
                p.as_os_str().as_bytes(),
                OFLAGS_CREAT_TRUNC,
                RIGHTS_FD_WRITE,
            );
            ops.push(op);
        }
    }
    if let Some(bytes) = input {
        std::fs::write(&stdin_path, bytes)?;
        let mut op = [0u8; FD_OP_SIZE];
        put_op(
            &mut op,
            FD_OP_OPEN,
            0,
            stdin_path.as_os_str().as_bytes(),
            0,
            0,
        );
        ops.push(op);
    }
    let mut pid = 0u32;
    let result = unsafe {
        proc_spawn3(
            name.as_ptr(),
            name.len() as u32,
            argv.as_ptr(),
            argv.len() as u32,
            envp.as_ptr(),
            envp.len() as u32,
            ops.as_ptr().cast(),
            ops.len() as u32,
            0,
            0,
            u32::from(!name.contains(&b'/')),
            path.as_ptr(),
            path.len() as u32,
            &mut pid,
        )
    };
    if result != 0 {
        for p in &paths {
            let _ = std::fs::remove_file(p);
        }
        return Err(io::Error::from_raw_os_error(i32::from(result)));
    }
    let mut option_pid = [0u8; 8];
    option_pid[0] = 1;
    option_pid[4..8].copy_from_slice(&pid.to_le_bytes());
    let mut status = [0u8; 6];
    let result = unsafe { proc_join(&mut option_pid, 0, &mut status) };
    if result != 0 {
        for p in &paths {
            let _ = std::fs::remove_file(p);
        }
        return Err(io::Error::from_raw_os_error(i32::from(result)));
    }
    let code = match status[0] {
        1 => i32::from(u16::from_le_bytes([status[2], status[3]])),
        2 => 128 + i32::from(status[4]),
        _ => return Err(io::Error::other("unexpected WASIX process status")),
    };
    let stdout = if capture {
        std::fs::read(&stdout_path)?
    } else {
        Vec::new()
    };
    let stderr = if capture {
        std::fs::read(&stderr_path)?
    } else {
        Vec::new()
    };
    for p in &paths {
        let _ = std::fs::remove_file(p);
    }
    Ok(Output {
        code,
        stdout,
        stderr,
    })
}
