//! The HTTP client against local servers, over std sockets (the same client
//! code the WASI build runs over the kernel's).

mod support;

use std::io::Read;
use std::time::{Duration, Instant};

use support::{ok, serve, Reply};
use wasix_net::http::{Agent, Error};

fn direct() -> Agent {
    Agent::builder().proxy_from_env(false).build()
}

#[test]
fn get_with_headers_reuses_the_connection() {
    let server = serve(|req| ok(&format!("{} {}", req.method, req.target)));
    let agent = direct();
    let url = format!("{}/a?b=1", server.base());
    let response = agent.get(&url).header("X-Test", "yes").call().unwrap();
    assert_eq!((response.status(), response.status_text()), (200, "OK"));
    assert_eq!(response.header("content-length"), Some("10"));
    assert_eq!(response.url(), url);
    assert_eq!(response.into_string().unwrap(), "GET /a?b=1");
    assert_eq!(
        agent.get(&url).call().unwrap().into_string().unwrap(),
        "GET /a?b=1"
    );
    let seen = server.requests();
    assert_eq!(seen[0].header("x-test"), Some("yes"));
    assert_eq!(
        seen[0].header("host"),
        Some(format!("127.0.0.1:{}", server.port).as_str())
    );
    assert_eq!(seen[0].header("accept-encoding"), Some("identity"));
    assert_eq!((seen[0].connection, seen[1].connection), (1, 1));
}

#[test]
fn post_bodies_binary_and_json() {
    let server = serve(|req| {
        let body = req.body.clone();
        let ty = req.header("content-type").unwrap_or("none").to_string();
        let mut out = format!(
            "HTTP/1.1 201 Created\r\nX-Type: {ty}\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend(body);
        Reply::Raw(out)
    });
    let agent = direct();
    let bytes: Vec<u8> = (0..=255u8).collect();
    let response = agent.post(&server.base()).send(&bytes).unwrap();
    assert_eq!(response.status(), 201);
    assert_eq!(response.into_bytes().unwrap(), bytes);
    let value = serde_json::json!({"a": [1, 2], "b": "ü"});
    let response = agent.post(&server.base()).send_json(&value).unwrap();
    assert_eq!(response.header("x-type"), Some("application/json"));
    assert_eq!(response.into_json::<serde_json::Value>().unwrap(), value);
    let response = agent.post(&server.base()).call().unwrap();
    assert_eq!(response.into_bytes().unwrap(), b"");
    assert_eq!(server.requests()[2].header("content-length"), Some("0"));
}

#[test]
fn chunked_and_until_close_bodies() {
    let server = serve(|req| match req.target.as_str() {
        "/chunked" => {
            let mut out = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
            for i in 0..100 {
                let chunk = vec![b'a' + (i % 26) as u8; 10_000];
                out.extend(format!("{:x}\r\n", chunk.len()).as_bytes());
                out.extend(chunk);
                out.extend(b"\r\n");
            }
            out.extend(b"0\r\n\r\n");
            Reply::Raw(out)
        }
        _ => Reply::Close(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nall of it".to_vec()),
    });
    let agent = direct();
    let mut reader = agent
        .get(&format!("{}/chunked", server.base()))
        .call()
        .unwrap()
        .into_reader();
    let mut body = Vec::new();
    let mut buf = [0u8; 777];
    loop {
        match reader.read(&mut buf).unwrap() {
            0 => break,
            n => body.extend_from_slice(&buf[..n]),
        }
    }
    assert_eq!(body.len(), 1_000_000);
    assert!(body[..10_000].iter().all(|b| *b == b'a') && body[10_000] == b'b');
    let text = agent
        .get(&format!("{}/eof", server.base()))
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "all of it");
}

#[test]
fn redirects() {
    let server = serve(|req| {
        let to = |status: u16, location: &str| {
            Reply::Raw(
                format!("HTTP/1.1 {status} Moved\r\nLocation: {location}\r\nContent-Length: 4\r\n\r\nmove")
                    .into_bytes(),
            )
        };
        match req.target.as_str() {
            "/a/start" => to(302, "next"),
            "/a/next" => to(301, "/final?x=1"),
            "/post-303" => to(303, "/final"),
            "/post-307" => to(307, "/echo"),
            "/loop" => to(302, "/loop"),
            "/echo" => ok(&format!(
                "{} {}",
                req.method,
                String::from_utf8_lossy(&req.body)
            )),
            _ => ok(&format!("{} {}", req.method, req.target)),
        }
    });
    let agent = direct();
    let base = server.base();
    let response = agent.get(&format!("{base}/a/start")).call().unwrap();
    assert_eq!(response.url(), format!("{base}/final?x=1"));
    assert_eq!(response.into_string().unwrap(), "GET /final?x=1");
    let response = agent
        .post(&format!("{base}/post-303"))
        .send(b"data")
        .unwrap();
    assert_eq!(response.into_string().unwrap(), "GET /final");
    let response = agent
        .post(&format!("{base}/post-307"))
        .send(b"data")
        .unwrap();
    assert_eq!(response.into_string().unwrap(), "POST data");
    let err = agent.get(&format!("{base}/loop")).call().unwrap_err();
    assert!(matches!(err, Error::TooManyRedirects(_)), "{err}");
    let manual = Agent::builder().proxy_from_env(false).redirects(0).build();
    let response = manual.get(&format!("{base}/a/start")).call().unwrap();
    assert_eq!(
        (response.status(), response.header("location")),
        (302, Some("next"))
    );
}

#[test]
fn through_a_proxy_in_absolute_form() {
    // The proxy answers itself, as the kernel's would after fetching.
    let proxy = serve(|req| {
        ok(&format!(
            "{} {} host={}",
            req.method,
            req.target,
            req.header("host").unwrap_or("")
        ))
    });
    let agent = Agent::builder()
        .proxy(&format!("http://127.0.0.1:{}", proxy.port))
        .build();
    let text = agent
        .get("https://example.test/p?q")
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "GET https://example.test/p?q host=example.test");
    let text = agent
        .get("http://example.test:8080/")
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "GET http://example.test:8080/ host=example.test:8080");
    // Both went over one kept-alive connection to the proxy.
    assert_eq!(
        proxy.connections.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[test]
fn proxy_from_the_environment_honours_no_proxy() {
    // The only test that reads the environment; the others build their
    // agents with `proxy_from_env(false)` or an explicit proxy.
    let proxy = serve(|req| ok(&format!("proxied {}", req.target)));
    let origin = serve(|req| ok(&format!("direct {}", req.target)));
    let proxy_url = format!("http://127.0.0.1:{}", proxy.port);
    for var in [
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "all_proxy",
        "ALL_PROXY",
    ] {
        std::env::remove_var(var);
    }
    std::env::set_var("HTTPS_PROXY", &proxy_url);
    std::env::set_var("http_proxy", &proxy_url);
    std::env::set_var("no_proxy", "localhost,.localhost,127.0.0.1,127.0.0.0/8");
    let agent = Agent::new();
    let text = agent
        .get("https://example.test/x")
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "proxied https://example.test/x");
    let text = agent
        .get("http://example.test/y")
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "proxied http://example.test/y");
    let text = agent
        .get(&format!("{}/z", origin.base()))
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(text, "direct /z");
    std::env::remove_var("HTTPS_PROXY");
    let err = agent.get("https://example.test/x").call().unwrap_err();
    assert!(matches!(err, Error::TlsUnsupported(_)), "{err}");
    for var in ["http_proxy", "no_proxy"] {
        std::env::remove_var(var);
    }
}

#[test]
fn a_stale_kept_alive_connection_is_retried_once() {
    // The server closes every connection after its response without
    // saying so, as an idle-timeout would.
    let server = serve(|req| {
        Reply::Close(match ok(&req.target) {
            Reply::Raw(b) => b,
            _ => unreachable!(),
        })
    });
    let agent = direct();
    for path in ["/1", "/2", "/3"] {
        let text = agent
            .get(&format!("{}{path}", server.base()))
            .call()
            .unwrap()
            .into_string()
            .unwrap();
        assert_eq!(text, path);
    }
    assert_eq!(
        server.connections.load(std::sync::atomic::Ordering::SeqCst),
        3
    );
}

#[test]
fn interim_responses_are_skipped() {
    let server = serve(|_| {
        Reply::Raw(
            b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi".to_vec(),
        )
    });
    assert_eq!(
        direct()
            .get(&server.base())
            .call()
            .unwrap()
            .into_string()
            .unwrap(),
        "hi"
    );
}

#[test]
fn timeouts_and_refused_connections() {
    let server = serve(|_| Reply::Hang);
    let started = Instant::now();
    let agent = Agent::builder()
        .proxy_from_env(false)
        .timeout_read(Duration::from_millis(200))
        .build();
    let err = agent.get(&server.base()).call().unwrap_err();
    assert!(
        matches!(&err, Error::Io(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock)),
        "{err:?}"
    );
    let agent = Agent::builder()
        .proxy_from_env(false)
        .timeout(Duration::from_millis(300))
        .build();
    assert!(agent.get(&server.base()).call().is_err());
    assert!(started.elapsed() < Duration::from_secs(5));

    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let err = direct()
        .get(&format!("http://127.0.0.1:{port}/"))
        .call()
        .unwrap_err();
    assert!(matches!(err, Error::Connect { .. }), "{err}");
    assert!(
        err.to_string().contains(&format!("127.0.0.1:{port}")),
        "{err}"
    );
}
