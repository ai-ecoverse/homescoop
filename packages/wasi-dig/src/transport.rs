//! Sending a query: DNS over HTTPS (RFC 8484 POST) through the kernel's
//! proxy, or DNS over TCP (RFC 1035 4.2.2, two-byte length prefix) through
//! the kernel's sockets. slicc has no UDP.

use crate::args::{Opts, Server, DEFAULT_DOH};
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use wasix_net::http::Agent;
use wasix_net::TcpStream;

pub struct Reply {
    pub bytes: Vec<u8>,
    /// For `;; SERVER:`.
    pub server: String,
    pub elapsed: Duration,
}

pub fn doh_url(server: &Server) -> Option<String> {
    match server {
        Server::Default => Some(
            std::env::var("DIG_DOH_URL")
                .ok()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| DEFAULT_DOH.to_string()),
        ),
        Server::Doh(url) => Some(url.clone()),
        Server::Tcp(_) => None,
    }
}

/// Where the query goes, for error messages.
pub fn describe(o: &Opts) -> String {
    match (&o.server, doh_url(&o.server)) {
        (_, Some(url)) => url,
        (Server::Tcp(host), None) => format!("{host}#{}", port(o)),
        _ => unreachable!(),
    }
}

fn port(o: &Opts) -> u16 {
    if o.port == 0 {
        53
    } else {
        o.port
    }
}

pub fn send(o: &Opts, query: &[u8]) -> Result<Reply, String> {
    let start = Instant::now();
    if let Some(url) = doh_url(&o.server) {
        let agent = Agent::builder().timeout(o.timeout).redirects(0).build();
        let res = agent
            .post(&url)
            .header("Content-Type", "application/dns-message")
            .header("Accept", "application/dns-message")
            .send(query)
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let ctype = res.header("content-type").unwrap_or("").to_ascii_lowercase();
        let bytes = res.into_bytes().map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(format!("HTTP {status} from {url}"));
        }
        if !ctype.starts_with("application/dns-message") {
            return Err(format!("{url} answered with Content-Type '{ctype}', not application/dns-message"));
        }
        return Ok(Reply { bytes, server: format!("{url} (HTTPS)"), elapsed: start.elapsed() });
    }
    let Server::Tcp(host) = &o.server else { unreachable!() };
    let port = port(o);
    let addrs = wasix_net::resolve(host, port).map_err(|e| format!("{host}: {e}"))?;
    if addrs.is_empty() {
        return Err(format!("{host}: no addresses"));
    }
    let mut last = String::new();
    for addr in &addrs {
        let mut s = match TcpStream::connect_timeout(addr, o.timeout) {
            Ok(s) => s,
            Err(e) => {
                last = format!("{addr}: {e}");
                continue;
            }
        };
        let io = |e: std::io::Error| format!("{addr}: {e}");
        s.set_read_timeout(Some(o.timeout)).map_err(io)?;
        s.set_write_timeout(Some(o.timeout)).map_err(io)?;
        let mut framed = Vec::with_capacity(query.len() + 2);
        framed.extend_from_slice(&(query.len() as u16).to_be_bytes());
        framed.extend_from_slice(query);
        s.write_all(&framed).map_err(io)?;
        let mut len = [0u8; 2];
        s.read_exact(&mut len).map_err(io)?;
        let mut bytes = vec![0u8; u16::from_be_bytes(len) as usize];
        s.read_exact(&mut bytes).map_err(io)?;
        let ip = addr.ip();
        return Ok(Reply {
            bytes,
            server: format!("{ip}#{port}({host}) (TCP)"),
            elapsed: start.elapsed(),
        });
    }
    Err(last)
}
