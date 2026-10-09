//! `hf auth login | logout | whoami`.

use std::fs;
use std::io::{self, BufRead, IsTerminal};
use std::path::Path;

use crate::hub::{self, Hub};

/// `whoami-v2`: the account's name and organisations, or why not.
fn whoami(token: &str) -> Result<(String, Vec<String>), String> {
    let hub = Hub::new(Some(token.to_string()));
    let (v, _) = hub.json("/api/whoami-v2").map_err(|e| {
        if e.starts_with("401") {
            "invalid token (the Hub answered 401)".to_string()
        } else {
            e
        }
    })?;
    let name = v["name"].as_str().unwrap_or("?").to_string();
    let orgs = v["orgs"]
        .as_array()
        .map(|a| a.iter().filter_map(|o| o["name"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    Ok((name, orgs))
}

pub fn login(token: Option<String>, verify: bool) -> Result<(), String> {
    let token = match token {
        Some(t) => t,
        None => {
            if io::stdin().is_terminal() {
                eprint!("Hugging Face token (https://huggingface.co/settings/tokens): ");
            }
            let mut line = String::new();
            io::stdin().lock().read_line(&mut line).map_err(|e| e.to_string())?;
            line
        }
    };
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("no token given (hf auth login --token <token>, or on stdin)".into());
    }
    if verify {
        let (name, _) = whoami(&token)?;
        eprintln!("hf: token is valid; logged in as {name}");
    }
    let path = hub::token_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    // Restrict the file before the token goes in, as huggingface_hub does.
    fs::write(&path, b"").map_err(|e| format!("{}: {e}", path.display()))?;
    if let Err(e) = private(&path) {
        eprintln!("hf: warning: could not make {} private (mode 0600): {e}", path.display());
    }
    fs::write(&path, format!("{token}\n")).map_err(|e| format!("{}: {e}", path.display()))?;
    eprintln!("hf: token saved to {}", path.display());
    if let Some((_, var)) = hub::env_token() {
        eprintln!("hf: note: {var} is set and takes precedence over the saved token");
    }
    Ok(())
}

pub fn logout() -> Result<(), String> {
    let path = hub::token_path();
    match fs::remove_file(&path) {
        Ok(()) => eprintln!("hf: removed {}", path.display()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => eprintln!("hf: not logged in"),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    }
    if let Some((_, var)) = hub::env_token() {
        eprintln!("hf: note: {var} is still set");
    }
    Ok(())
}

pub fn show() -> Result<(), String> {
    let Some(token) = hub::token() else {
        return Err("not logged in (hf auth login, or set HF_TOKEN)".into());
    };
    let (name, orgs) = whoami(&token)?;
    println!("{name}");
    if !orgs.is_empty() {
        println!("orgs: {}", orgs.join(","));
    }
    Ok(())
}

/// Mode 0600. WASI has no chmod, so in slicc's kernel this goes through the
/// command's host import (package/host/hf-host.mjs).
#[cfg(target_os = "wasi")]
fn private(path: &Path) -> io::Result<()> {
    #[link(wasm_import_module = "hf_host")]
    extern "C" {
        fn chmod(path: *const u8, len: usize, mode: u32) -> i32;
    }
    let p = path.to_string_lossy();
    match unsafe { chmod(p.as_ptr(), p.len(), 0o600) } {
        0 => Ok(()),
        52 => Err(io::Error::new(io::ErrorKind::Unsupported, "no hf_host.chmod in this kernel")),
        n => Err(io::Error::other(format!("errno {n}"))),
    }
}

#[cfg(unix)]
fn private(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(any(unix, target_os = "wasi")))]
fn private(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn token_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("wasi-hf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("token");
        std::fs::write(&file, "x").unwrap();
        super::private(&file).unwrap();
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
