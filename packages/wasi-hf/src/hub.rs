//! The Hub: endpoint, token and JSON API calls.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;
use wasix_net::http::{Agent, Request, Response};

use crate::util;

pub const USER_AGENT: &str = concat!("hf/", env!("CARGO_PKG_VERSION"), " (wasi-hf; slicc)");

/// Where `hf auth login` keeps the token: `HF_TOKEN_PATH`, else
/// `$HF_HOME/token`, else `~/.cache/huggingface/token`.
pub fn token_path() -> PathBuf {
    if let Ok(p) = std::env::var("HF_TOKEN_PATH") {
        if !p.is_empty() {
            return util::absolute(&p);
        }
    }
    let hf_home = match std::env::var("HF_HOME") {
        Ok(h) if !h.is_empty() => util::absolute(&h),
        _ => util::home().join(".cache/huggingface"),
    };
    hf_home.join("token")
}

/// The token from the environment, if any (`HF_TOKEN`, then the legacy
/// `HUGGING_FACE_HUB_TOKEN`).
pub fn env_token() -> Option<(String, &'static str)> {
    for name in ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"] {
        if let Ok(v) = std::env::var(name) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some((v, name));
            }
        }
    }
    None
}

/// The token to send: the environment first, then the token file.
pub fn token() -> Option<String> {
    if let Some((t, _)) = env_token() {
        return Some(t);
    }
    std::fs::read_to_string(token_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn endpoint() -> String {
    std::env::var("HF_ENDPOINT")
        .ok()
        .map(|e| e.trim().trim_end_matches('/').to_string())
        .filter(|e| e.starts_with("http://") || e.starts_with("https://"))
        .unwrap_or_else(|| "https://huggingface.co".into())
}

#[derive(Clone)]
pub struct Hub {
    pub agent: Agent,
    pub endpoint: String,
    pub token: Option<String>,
}

impl Hub {
    pub fn new(token: Option<String>) -> Hub {
        let agent = Agent::builder()
            .user_agent(USER_AGENT)
            .timeout_connect(Duration::from_secs(60))
            .timeout_read(Duration::from_secs(120))
            .build();
        Hub { agent, endpoint: endpoint(), token }
    }

    /// A GET with the token. wasix-net drops `Authorization` when a
    /// redirect leaves the endpoint's host, so the CDN never sees it.
    pub fn get(&self, url: &str) -> Request {
        let req = self.agent.get(url);
        match &self.token {
            Some(t) => req.header("Authorization", &format!("Bearer {t}")),
            None => req,
        }
    }

    pub fn url(&self, path_or_url: &str) -> String {
        if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
            path_or_url.to_string()
        } else {
            format!("{}{}", self.endpoint, path_or_url)
        }
    }

    /// GET a JSON document; the `Link: rel="next"` target comes with it.
    pub fn json(&self, url: &str) -> Result<(Value, Option<String>), String> {
        let url = self.url(url);
        let res = self
            .get(&url)
            .header("Accept", "application/json")
            .call()
            .map_err(|e| format!("{url}: {e}"))?;
        if res.status() != 200 {
            return Err(status_error(&url, res));
        }
        let next = res.header("link").and_then(util::next_link).map(|n| self.url(&n));
        let body = res.into_string().map_err(|e| format!("{url}: {e}"))?;
        let value = serde_json::from_str(&body).map_err(|e| format!("{url}: bad JSON: {e}"))?;
        Ok((value, next))
    }
}

/// A one-line error for a non-2xx answer, with the Hub's own message.
pub fn status_error(url: &str, res: Response) -> String {
    let status = res.status();
    let mut message = res.header("x-error-message").map(str::to_string);
    if message.is_none() {
        let body = res.into_string().unwrap_or_default();
        message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_string));
    }
    let hint = match status {
        401 | 403 => " (private or gated: run `hf auth login` or set HF_TOKEN)",
        _ => "",
    };
    match message {
        Some(m) if !m.is_empty() => format!("{status} for {url}: {m}{hint}"),
        _ => format!("{status} for {url}{hint}"),
    }
}
