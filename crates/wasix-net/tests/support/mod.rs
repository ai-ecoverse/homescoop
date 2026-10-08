//! A scripted HTTP/1.1 server on 127.0.0.1 for the host tests.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Debug, Clone)]
pub struct Seen {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Which connection (counting from 1) carried it.
    pub connection: usize,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub enum Reply {
    /// Raw response bytes; the connection stays open.
    Raw(Vec<u8>),
    /// Raw response bytes, then the server closes the connection.
    Close(Vec<u8>),
    /// No answer: the connection is held open until the server ends.
    Hang,
}

pub fn ok(body: &str) -> Reply {
    Reply::Raw(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes(),
    )
}

pub struct Server {
    pub port: u16,
    pub seen: Arc<Mutex<Vec<Seen>>>,
    pub connections: Arc<AtomicUsize>,
}

impl Server {
    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn requests(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

fn read_request(r: &mut BufReader<TcpStream>, connection: usize) -> Option<Seen> {
    let mut line = String::new();
    if r.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        r.read_line(&mut line).ok()?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (k, v) = line.split_once(':')?;
        headers.push((k.to_string(), v.trim().to_string()));
    }
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .map_or(0, |(_, v)| v.parse().unwrap());
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).ok()?;
    Some(Seen {
        method,
        target,
        headers,
        body,
        connection,
    })
}

/// Serves until the test process ends, answering each request with
/// `handler`.
pub fn serve(handler: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let connections = Arc::new(AtomicUsize::new(0));
    let handler = Arc::new(handler);
    let (s, c) = (seen.clone(), connections.clone());
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { return };
            let id = c.fetch_add(1, Ordering::SeqCst) + 1;
            let (seen, handler) = (s.clone(), handler.clone());
            thread::spawn(move || {
                let mut w = stream.try_clone().unwrap();
                let mut r = BufReader::new(stream);
                let mut held = Vec::new();
                while let Some(req) = read_request(&mut r, id) {
                    seen.lock().unwrap().push(req.clone());
                    match handler(&req) {
                        Reply::Raw(bytes) => {
                            if w.write_all(&bytes).is_err() {
                                return;
                            }
                        }
                        Reply::Close(bytes) => {
                            let _ = w.write_all(&bytes);
                            return;
                        }
                        Reply::Hang => held.push(w.try_clone().unwrap()),
                    }
                }
            });
        }
    });
    Server {
        port,
        seen,
        connections,
    }
}
