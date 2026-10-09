//! `hf auth login | logout | whoami`.

use std::fs;
use std::io::{self, BufRead, IsTerminal};

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
