//! ureq 2's behaviour for the calls impeccable makes.

#[path = "../../wasix-net/tests/support/mod.rs"]
mod support;

use std::io::Read;
use std::time::Duration;

use support::{ok, serve, Reply};

#[test]
fn statuses_of_400_and_up_are_errors_with_the_response() {
    let server = serve(|req| match req.target.as_str() {
        "/missing" => Reply::Raw(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 13\r\n\r\n{\"error\":\"x\"}".to_vec(),
        ),
        _ => ok("fine"),
    });
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .build();
    let response = agent.get(&format!("{}/ok", server.base())).call().unwrap();
    assert_eq!((response.status(), response.status_text()), (200, "OK"));
    assert_eq!(response.into_string().unwrap(), "fine");
    match agent.get(&format!("{}/missing", server.base())).call() {
        Err(ureq::Error::Status(404, response)) => {
            assert_eq!(response.status_text(), "Not Found");
            let body: serde_json::Value = response.into_json().unwrap();
            assert_eq!(body["error"], "x");
        }
        other => panic!("{other:?}"),
    }
    let err = ureq::get(&format!("{}/missing", server.base()))
        .call()
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        format!("{}/missing: status code 404", server.base())
    );
}

#[test]
fn send_string_bytes_and_json_set_content_types_like_ureq() {
    let server = serve(|req| ok(req.header("content-type").unwrap_or("none")));
    let base = server.base();
    let text = |r: ureq::Result<ureq::Response>| r.unwrap().into_string().unwrap();
    assert_eq!(
        text(ureq::post(&base).send_string("hi")),
        "text/plain; charset=utf-8"
    );
    assert_eq!(
        text(
            ureq::post(&base)
                .set("Content-Type", "application/json")
                .send_string("{}")
        ),
        "application/json"
    );
    assert_eq!(text(ureq::post(&base).send_bytes(b"\x00\x01")), "none");
    assert_eq!(
        text(ureq::post(&base).send_json(serde_json::json!({"a": 1}))),
        "application/json"
    );
    let bodies: Vec<Vec<u8>> = server.requests().into_iter().map(|s| s.body).collect();
    assert_eq!(
        bodies,
        [
            b"hi".to_vec(),
            b"{}".to_vec(),
            vec![0, 1],
            br#"{"a":1}"#.to_vec()
        ]
    );
}

#[test]
fn redirects_zero_hands_back_the_redirect() {
    let server = serve(|req| match req.target.as_str() {
        "/r" => {
            Reply::Raw(b"HTTP/1.1 302 Found\r\nLocation: /t\r\nContent-Length: 0\r\n\r\n".to_vec())
        }
        _ => ok("target"),
    });
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let response = agent.get(&format!("{}/r", server.base())).call().unwrap();
    assert_eq!(
        (response.status(), response.header("location")),
        (302, Some("/t"))
    );
    let mut body = String::new();
    ureq::get(&format!("{}/r", server.base()))
        .call()
        .unwrap()
        .into_reader()
        .read_to_string(&mut body)
        .unwrap();
    assert_eq!(body, "target");
}

#[test]
fn transport_errors() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    match ureq::get(&format!("http://127.0.0.1:{port}/")).call() {
        Err(ureq::Error::Transport(t)) => {
            assert_eq!(t.kind(), ureq::ErrorKind::ConnectionFailed);
            // impeccable's live-poll looks for this text.
            assert!(t.to_string().contains("Connection refused"), "{t}");
        }
        other => panic!("{other:?}"),
    }
    match ureq::get("https://example.invalid/").call() {
        Err(ureq::Error::Transport(t)) => {
            assert_eq!(t.kind(), ureq::ErrorKind::UnknownScheme);
            assert!(t.to_string().contains("no TLS"), "{t}");
        }
        other => panic!("{other:?}"),
    }
    match ureq::get("not a url").call() {
        Err(ureq::Error::Transport(t)) => assert_eq!(t.kind(), ureq::ErrorKind::InvalidUrl),
        other => panic!("{other:?}"),
    }
    let server = serve(|_| Reply::Hang);
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(200))
        .build();
    match agent.get(&server.base()).call() {
        Err(ureq::Error::Transport(t)) => assert_eq!(t.kind(), ureq::ErrorKind::Io),
        other => panic!("{other:?}"),
    }
}
