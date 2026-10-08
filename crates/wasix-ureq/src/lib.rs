//! The part of ureq 2's API that impeccable uses, over [`wasix_net::http`].
//!
//! ureq cannot run in slicc's kernel: its TLS (rustls, ring) does not
//! build for WASI, it connects with std sockets (stubbed on WASI), and it
//! has no transport hook in 2.x. This crate's library is named `ureq`, so a
//! package swaps it in for its WASI build only, keeping its code, by moving
//! its ureq dependency under a target and adding this one beside it:
//!
//! ```toml
//! [target.'cfg(not(target_os = "wasi"))'.dependencies]
//! ureq = { version = "2", features = ["json"] }
//!
//! [target.'cfg(target_os = "wasi")'.dependencies]
//! wasix-ureq = { path = "homescoop-crates/wasix-ureq", features = ["json"] }
//! ```
//!
//! (Cargo refuses `ureq = { package = "wasix-ureq" }` next to the real
//! `ureq`: one dependency name cannot have two sources.)
//!
//! This is not a ureq clone. It has exactly:
//! - `AgentBuilder::{new, timeout, timeout_connect, timeout_read,
//!   timeout_write, redirects, try_proxy_from_env, build}`
//! - `Agent::{new, request, get, post}`, and the free `get` and `post`
//! - `Request::{set, timeout, call, send_string, send_bytes, send_json}`
//! - `Response::{status, status_text, header, into_string, into_reader,
//!   into_json}`
//! - `Error::{Status, Transport}`, `Transport::kind`, `ErrorKind`
//!
//! Differences from ureq 2.12:
//! - There is no TLS. `https://` works through the proxy that
//!   `https_proxy` names (with `try_proxy_from_env(true)`), which takes the
//!   request in absolute form and does TLS itself; without a proxy it is a
//!   `Transport` error of kind `UnknownScheme`, as in a ureq built without
//!   TLS. SOCKS and `https://` proxies are `InvalidProxyUrl`.
//! - The proxy follows the scheme (`https_proxy` for https, `http_proxy`
//!   for http, then `all_proxy`) and honours `no_proxy`, so the realm's
//!   loopback is reached directly.
//! - `redirects(n)` follows up to `n` redirects (ureq stops one earlier),
//!   and 307 / 308 repeat a request with a body instead of returning.

// `Error::Status` carries the response, as in ureq.
#![allow(clippy::result_large_err)]

use std::fmt;
use std::io::{self, Read};
use std::time::Duration;

use wasix_net::http as net;

/// Response bodies [`Response::into_string`] reads at most.
const MAX_STRING: u64 = 10 * 1024 * 1024;
const USER_AGENT: &str = "ureq/2.12.1";

pub type Result<T> = std::result::Result<T, Error>;

/// A GET with a default agent.
pub fn get(path: &str) -> Request {
    Agent::new().get(path)
}

/// A POST with a default agent.
pub fn post(path: &str) -> Request {
    Agent::new().post(path)
}

#[derive(Debug, Clone)]
pub struct AgentBuilder {
    builder: net::AgentBuilder,
}

impl Default for AgentBuilder {
    fn default() -> AgentBuilder {
        AgentBuilder::new()
    }
}

impl AgentBuilder {
    /// No proxy, 5 redirects, no timeouts.
    pub fn new() -> AgentBuilder {
        let builder = net::AgentBuilder::new()
            .proxy_from_env(false)
            .redirects(5)
            .user_agent(USER_AGENT);
        AgentBuilder { builder }
    }

    pub fn timeout_connect(self, timeout: Duration) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.timeout_connect(timeout),
        }
    }

    pub fn timeout_read(self, timeout: Duration) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.timeout_read(timeout),
        }
    }

    pub fn timeout_write(self, timeout: Duration) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.timeout_write(timeout),
        }
    }

    /// The whole request, body included.
    pub fn timeout(self, timeout: Duration) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.timeout(timeout),
        }
    }

    /// 0 returns redirects as responses.
    pub fn redirects(self, n: u32) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.redirects(n),
        }
    }

    /// Take the proxy from `https_proxy` / `http_proxy` / `all_proxy`
    /// (honouring `no_proxy`).
    pub fn try_proxy_from_env(self, on: bool) -> AgentBuilder {
        AgentBuilder {
            builder: self.builder.proxy_from_env(on),
        }
    }

    pub fn build(self) -> Agent {
        Agent {
            agent: self.builder.build(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Agent {
    agent: net::Agent,
}

impl Default for Agent {
    fn default() -> Agent {
        Agent::new()
    }
}

impl Agent {
    pub fn new() -> Agent {
        AgentBuilder::new().build()
    }

    pub fn request(&self, method: &str, path: &str) -> Request {
        Request {
            request: self.agent.request(method, path),
        }
    }

    pub fn get(&self, path: &str) -> Request {
        self.request("GET", path)
    }

    pub fn post(&self, path: &str) -> Request {
        self.request("POST", path)
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    request: net::Request,
}

impl Request {
    /// Sets a header, replacing one of the same name.
    pub fn set(self, header: &str, value: &str) -> Request {
        Request {
            request: self.request.header(header, value),
        }
    }

    /// The whole request, overriding the agent's timeout.
    pub fn timeout(self, timeout: Duration) -> Request {
        Request {
            request: self.request.timeout(timeout),
        }
    }

    pub fn call(self) -> Result<Response> {
        let url = self.request.url().to_string();
        finish(self.request.call(), &url)
    }

    /// Sends `data`, as `text/plain; charset=utf-8` unless a content type
    /// is set.
    pub fn send_string(self, data: &str) -> Result<Response> {
        let request = if self.request.get_header("content-type").is_some() {
            self.request
        } else {
            self.request
                .header("Content-Type", "text/plain; charset=utf-8")
        };
        let url = request.url().to_string();
        finish(request.send(data.as_bytes()), &url)
    }

    pub fn send_bytes(self, data: &[u8]) -> Result<Response> {
        let url = self.request.url().to_string();
        finish(self.request.send(data), &url)
    }

    /// Sends `data` as JSON, as `application/json` unless a content type is
    /// set.
    #[cfg(feature = "json")]
    pub fn send_json(self, data: impl serde::Serialize) -> Result<Response> {
        let url = self.request.url().to_string();
        finish(self.request.send_json(&data), &url)
    }
}

fn finish(result: std::result::Result<net::Response, net::Error>, url: &str) -> Result<Response> {
    match result {
        Ok(response) if response.status() >= 400 => {
            Err(Error::Status(response.status(), Response { response }))
        }
        Ok(response) => Ok(Response { response }),
        Err(e) => Err(Error::Transport(Transport::new(e, url))),
    }
}

#[derive(Debug)]
pub struct Response {
    response: net::Response,
}

impl Response {
    pub fn status(&self) -> u16 {
        self.response.status()
    }

    pub fn status_text(&self) -> &str {
        self.response.status_text()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.response.header(name)
    }

    pub fn into_reader(self) -> Box<dyn Read + Send + Sync + 'static> {
        Box::new(self.response.into_reader())
    }

    /// The body as UTF-8, up to 10 MB (more is an error).
    pub fn into_string(self) -> io::Result<String> {
        let mut bytes = Vec::new();
        self.response
            .into_reader()
            .take(MAX_STRING + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_STRING {
            return Err(io::Error::other("response too big for into_string"));
        }
        String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    #[cfg(feature = "json")]
    pub fn into_json<T: serde::de::DeserializeOwned>(self) -> io::Result<T> {
        self.response.into_json()
    }
}

/// A status of 400 or more, or a failure to get a response at all.
#[derive(Debug)]
pub enum Error {
    Status(u16, Response),
    Transport(Transport),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Status(status, response) => {
                write!(f, "{}: status code {status}", response.response.url())
            }
            Error::Transport(t) => write!(f, "{t}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Transport(t) => Some(&t.source),
            Error::Status(..) => None,
        }
    }
}

/// Why no response came.
#[derive(Debug)]
pub struct Transport {
    kind: ErrorKind,
    url: String,
    source: net::Error,
}

impl Transport {
    fn new(source: net::Error, url: &str) -> Transport {
        let kind = match &source {
            net::Error::BadUrl(_) => ErrorKind::InvalidUrl,
            net::Error::UnsupportedScheme(_) | net::Error::TlsUnsupported(_) => {
                ErrorKind::UnknownScheme
            }
            net::Error::BadProxy(_) => ErrorKind::InvalidProxyUrl,
            net::Error::BadHeader(_) => ErrorKind::BadHeader,
            net::Error::Protocol(_) => ErrorKind::BadStatus,
            net::Error::TooManyRedirects(_) => ErrorKind::TooManyRedirects,
            net::Error::Io(_) => ErrorKind::Io,
            _ => ErrorKind::ConnectionFailed,
        };
        Transport {
            kind,
            url: url.to_string(),
            source,
        }
    }

    pub fn kind(&self) -> ErrorKind {
        self.kind
    }
}

impl fmt::Display for Transport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}: {}", self.url, self.kind, self.source)
    }
}

/// ureq 2's error kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    InvalidUrl,
    UnknownScheme,
    Dns,
    InsecureRequestHttpsOnly,
    ConnectionFailed,
    TooManyRedirects,
    BadStatus,
    BadHeader,
    Io,
    InvalidProxyUrl,
    ProxyConnect,
    ProxyUnauthorized,
    HTTP,
}

impl fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ErrorKind::InvalidUrl => "Bad URL",
            ErrorKind::UnknownScheme => "Unknown Scheme",
            ErrorKind::Dns => "Dns Failed",
            ErrorKind::InsecureRequestHttpsOnly => "Insecure request attempted with https_only set",
            ErrorKind::ConnectionFailed => "Connection Failed",
            ErrorKind::TooManyRedirects => "Too Many Redirects",
            ErrorKind::BadStatus => "Bad Status",
            ErrorKind::BadHeader => "Bad Header",
            ErrorKind::Io => "Network Error",
            ErrorKind::InvalidProxyUrl => "Malformed proxy",
            ErrorKind::ProxyConnect => "Proxy failed to connect",
            ErrorKind::ProxyUnauthorized => "Provided proxy credentials are incorrect",
            ErrorKind::HTTP => "HTTP status error",
        })
    }
}
