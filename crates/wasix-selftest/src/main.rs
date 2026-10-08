//! Exercises wasix-net, wasix-ureq and wasix-command where they matter: in
//! slicc's kernel (`test/kernel/*.test.mjs` runs it there). It builds and
//! runs natively too, over std.
//!
//! - `http METHOD URL [-H 'Name: value']… [--data TEXT | --data-hex HEX |
//!   --json TEXT] [--redirects N] [--timeout-ms N] [--ureq]`: one request
//!   with the proxy from the environment; prints `status`, `url`, each
//!   `header`, a blank line and the body.
//! - `loopback`: a TCP round trip and an HTTP request between this process
//!   and a child over the kernel's loopback.
//! - `spawn`: wasix-command's API, one `ok <check>` line per check.
//! - `detach PATH`: starts a child that writes PATH a moment later, and
//!   exits without waiting for it.
//! - `child …`: what the checks run as children.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::exit;
use std::time::Duration;

use wasix_command::{Command, Stdio};
use wasix_net::http::{Agent, Error};
use wasix_net::{TcpListener, TcpStream};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    let code = match args.first().map(String::as_str) {
        Some("http") => http(&rest),
        Some("loopback") => loopback(),
        Some("spawn") => spawn(),
        Some("detach") => detach(&rest),
        Some("child") => child(&rest),
        _ => {
            eprintln!("usage: wasix-selftest http|loopback|spawn|detach|child …");
            2
        }
    };
    exit(code);
}

/// How to start this program again.
fn me() -> Command {
    let program = std::env::var("WASIX_SELFTEST").unwrap_or_else(|_| {
        if cfg!(target_os = "wasi") {
            "wasix-selftest".into()
        } else {
            std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        }
    });
    Command::new(program)
}

fn fail(what: &str, detail: impl std::fmt::Debug) -> ! {
    eprintln!("FAIL {what}: {detail:?}");
    exit(1)
}

fn check(what: &str, ok: bool, detail: impl std::fmt::Debug) {
    if ok {
        println!("ok {what}");
    } else {
        fail(what, detail);
    }
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

fn http(args: &[&str]) -> i32 {
    let (method, url) = match args {
        [m, u, ..] => (*m, *u),
        _ => return 2,
    };
    let mut headers = Vec::new();
    let mut body: Option<Vec<u8>> = None;
    let mut json = false;
    let mut redirects = None;
    let mut timeout = None;
    let mut use_ureq = false;
    let mut i = 2;
    while i < args.len() {
        let value = args.get(i + 1).copied().unwrap_or_default();
        match args[i] {
            "-H" => {
                let (n, v) = value.split_once(':').expect("Name: value");
                headers.push((n.trim().to_string(), v.trim().to_string()));
                i += 1;
            }
            "--data" => {
                body = Some(value.as_bytes().to_vec());
                i += 1;
            }
            "--data-hex" => {
                body = Some(unhex(value));
                i += 1;
            }
            "--json" => {
                body = Some(value.as_bytes().to_vec());
                json = true;
                i += 1;
            }
            "--redirects" => {
                redirects = Some(value.parse().expect("number"));
                i += 1;
            }
            "--timeout-ms" => {
                timeout = Some(Duration::from_millis(value.parse().expect("number")));
                i += 1;
            }
            "--ureq" => use_ureq = true,
            other => fail("argument", other),
        }
        i += 1;
    }
    if use_ureq {
        return http_ureq(method, url, &headers, body, json, redirects, timeout);
    }
    let mut builder = Agent::builder();
    if let Some(n) = redirects {
        builder = builder.redirects(n);
    }
    if let Some(t) = timeout {
        builder = builder.timeout(t);
    }
    let mut request = builder.build().request(method, url);
    for (n, v) in &headers {
        request = request.header(n, v);
    }
    let result = match (body, json) {
        (Some(b), true) => {
            let value: serde_json::Value = serde_json::from_slice(&b).expect("JSON");
            request.send_json(&value)
        }
        (Some(b), false) => request.send(&b),
        (None, _) => request.call(),
    };
    let response = match result {
        Ok(r) => r,
        Err(e) => {
            let kind = match &e {
                Error::TlsUnsupported(_) => "tls-unsupported",
                Error::Connect { .. } => "connect",
                Error::Io(_) => "io",
                Error::TooManyRedirects(_) => "too-many-redirects",
                _ => "other",
            };
            eprintln!("error {kind}: {e}");
            return 3;
        }
    };
    let mut out = format!("status {}\nurl {}\n", response.status(), response.url());
    for (n, v) in response.headers() {
        out.push_str(&format!("header {}: {v}\n", n.to_ascii_lowercase()));
    }
    out.push('\n');
    let mut stdout = io::stdout().lock();
    stdout.write_all(out.as_bytes()).unwrap();
    io::copy(&mut response.into_reader(), &mut stdout).unwrap();
    stdout.flush().unwrap();
    0
}

fn http_ureq(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
    json: bool,
    redirects: Option<u32>,
    timeout: Option<Duration>,
) -> i32 {
    let mut builder = ureq::AgentBuilder::new().try_proxy_from_env(true);
    if let Some(n) = redirects {
        builder = builder.redirects(n);
    }
    if let Some(t) = timeout {
        builder = builder.timeout(t);
    }
    let mut request = builder.build().request(method, url);
    for (n, v) in headers {
        request = request.set(n, v);
    }
    let result = match (body, json) {
        (Some(b), true) => {
            request.send_json(serde_json::from_slice::<serde_json::Value>(&b).unwrap())
        }
        (Some(b), false) => request.send_bytes(&b),
        (None, _) => request.call(),
    };
    let (status, response) = match result {
        Ok(r) => (r.status(), r),
        Err(ureq::Error::Status(code, r)) => {
            println!("ureq status error {code}");
            (code, r)
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("ureq transport {:?}: {t}", t.kind());
            return 3;
        }
    };
    println!("status {status} {}", response.status_text());
    if let Some(ty) = response.header("content-type") {
        println!("header content-type: {ty}");
    }
    println!();
    print!("{}", response.into_string().unwrap());
    0
}

fn read_line(stream: &TcpStream) -> String {
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    line.trim_end().to_string()
}

fn loopback() -> i32 {
    // A TCP round trip with a child process.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    check(
        "listen on loopback",
        addr.ip().is_loopback() && addr.port() != 0,
        addr,
    );
    let child = me()
        .args(["child", "connect", &addr.port().to_string(), "hello"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let (stream, peer) = listener.accept().unwrap();
    check("accept", peer.ip().is_loopback(), peer);
    check(
        "local and peer names",
        stream.local_addr().unwrap().port() == addr.port(),
        stream.local_addr(),
    );
    let line = read_line(&stream);
    check("read from the child", line == "hello", &line);
    (&stream).write_all(b"olleh\n").unwrap();
    let output = child.wait_with_output().unwrap();
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    check(
        "the child read the reply",
        output.status.success() && text == "olleh",
        (&output.status, &text),
    );

    // HTTP from a child, directly over loopback (no_proxy), to a server here.
    let listener = TcpListener::bind(("localhost", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let child = me()
        .args(["http", "GET", &format!("http://127.0.0.1:{port}/loop?x=1")])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut reader = BufReader::new(&stream);
    let mut head = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line.trim_end().is_empty() {
            break;
        }
        head.push(line.trim_end().to_string());
    }
    check(
        "origin-form request",
        head.first().map(String::as_str) == Some("GET /loop?x=1 HTTP/1.1"),
        &head,
    );
    check(
        "host header",
        head.iter().any(|h| h == &format!("Host: 127.0.0.1:{port}")),
        &head,
    );
    (&stream)
        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nloop\r\n4\r\nback\r\n0\r\n\r\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    check(
        "HTTP over loopback",
        output.status.success()
            && text.starts_with("status 200\n")
            && text.ends_with("\n\nloopback"),
        (
            &output.status,
            &text,
            String::from_utf8_lossy(&output.stderr),
        ),
    );

    // A closed port refuses the connection.
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let refused = TcpStream::connect(("127.0.0.1", port)).map(|_| ());
    check(
        "connection refused",
        refused
            .as_ref()
            .is_err_and(|e| e.kind() == io::ErrorKind::ConnectionRefused),
        refused,
    );

    // A read timeout ends a read that would block.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (_server, _) = listener.accept().unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    let err = (&client).read(&mut [0u8; 8]).unwrap_err();
    check(
        "read timeout",
        matches!(
            err.kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
        ),
        err,
    );
    0
}

fn spawn() -> i32 {
    let out = me().args(["child", "exit", "3"]).output().unwrap();
    check(
        "exit code",
        out.status.code() == Some(3) && !out.status.success(),
        out.status,
    );
    check(
        "display",
        out.status.to_string() == "exit status: 3",
        out.status.to_string(),
    );

    let out = me().args(["child", "spam", "300000"]).output().unwrap();
    check(
        "stdout and stderr past a pipe's buffer",
        out.status.success()
            && out.stdout.len() == 300_000
            && out.stderr.len() == 300_000
            && out.stdout.iter().all(|b| *b == b'o')
            && out.stderr.iter().all(|b| *b == b'e'),
        (out.status, out.stdout.len(), out.stderr.len()),
    );

    let mut child = me()
        .args(["child", "echo"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(b"ping").unwrap();
    let out = child.wait_with_output().unwrap();
    check(
        "piped stdin",
        out.stdout == b"got:ping",
        String::from_utf8_lossy(&out.stdout),
    );

    let out = me().args(["child", "echo"]).output().unwrap();
    check(
        "stdin is null for output()",
        out.stdout == b"got:",
        String::from_utf8_lossy(&out.stdout),
    );

    let out = me()
        .args(["child", "env", "WASIX_A", "WASIX_B"])
        .env("WASIX_A", "a value")
        .env("WASIX_B", "gone")
        .env_remove("WASIX_B")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    check(
        "env and env_remove",
        text == "WASIX_A=a value\nWASIX_B unset\n",
        &text,
    );

    let out = me()
        .args(["child", "env", "PATH"])
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .output()
        .unwrap();
    check(
        "env_clear keeps what is set after it",
        out.status.success() && out.stdout.starts_with(b"PATH="),
        &out,
    );

    std::fs::create_dir_all("/tmp/wasix-selftest-cwd").unwrap();
    let out = me()
        .args(["child", "pwd"])
        .current_dir("/tmp/wasix-selftest-cwd")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    let pwd = if cfg!(target_os = "wasi") {
        text.lines().next()
    } else {
        text.lines().nth(1)
    };
    check(
        "current_dir",
        pwd.is_some_and(|d| d.ends_with("/tmp/wasix-selftest-cwd")),
        &text,
    );

    let status = me()
        .args(["child", "exit", "0"])
        .stdout(Stdio::null())
        .status()
        .unwrap();
    check(
        "status()",
        status.success() && status.code() == Some(0),
        status,
    );

    let path = "/tmp/wasix-selftest-out.txt";
    let file = std::fs::File::create(path).unwrap();
    let status = me()
        .args(["child", "say", "into a file"])
        .stdout(file)
        .status()
        .unwrap();
    let text = std::fs::read_to_string(path).unwrap_or_default();
    check(
        "stdout to a file",
        status.success() && text == "into a file\n",
        &text,
    );

    let mut first = me()
        .args(["child", "say", "through"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let second = me()
        .args(["child", "echo"])
        .stdin(Stdio::from(first.stdout.take().unwrap()))
        .output()
        .unwrap();
    first.wait().unwrap();
    check(
        "one child's stdout as another's stdin",
        second.stdout == b"got:through\n",
        String::from_utf8_lossy(&second.stdout),
    );

    let mut sleeper = me().args(["child", "sleep", "30000"]).spawn().unwrap();
    check("id", sleeper.id() > 0, sleeper.id());
    let early = sleeper.try_wait().unwrap();
    check("try_wait while running", early.is_none(), early);
    sleeper.kill().unwrap();
    let status = sleeper.wait().unwrap();
    check("kill", !status.success() && status.code().is_none(), status);
    sleeper.kill().unwrap();

    let mut quick = me().args(["child", "exit", "7"]).spawn().unwrap();
    let mut status = None;
    for _ in 0..200 {
        status = quick.try_wait().unwrap();
        if status.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    check(
        "try_wait after exit",
        status.and_then(|s| s.code()) == Some(7),
        status,
    );

    let missing = Command::new("wasix-selftest-no-such-command").output();
    check(
        "a missing program",
        missing
            .as_ref()
            .is_err_and(|e| e.kind() == io::ErrorKind::NotFound),
        missing.map(|o| o.status),
    );
    0
}

fn detach(args: &[&str]) -> i32 {
    let [path] = args else { return 2 };
    let child = me()
        .args(["child", "touch-after", "500", path])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    println!("detached {}", child.id());
    drop(child);
    0
}

fn child(args: &[&str]) -> i32 {
    match args {
        ["exit", code] => code.parse().unwrap(),
        ["say", text] => {
            println!("{text}");
            0
        }
        ["echo"] => {
            let mut input = Vec::new();
            io::stdin().read_to_end(&mut input).unwrap();
            let mut out = io::stdout().lock();
            out.write_all(b"got:").unwrap();
            out.write_all(&input).unwrap();
            0
        }
        ["spam", n] => {
            let n: usize = n.parse().unwrap();
            let (o, e) = (vec![b'o'; 4096], vec![b'e'; 4096]);
            let (mut out, mut err) = (io::stdout().lock(), io::stderr().lock());
            let mut left = n;
            while left > 0 {
                let k = left.min(4096);
                out.write_all(&o[..k]).unwrap();
                out.flush().unwrap();
                err.write_all(&e[..k]).unwrap();
                left -= k;
            }
            0
        }
        ["env", names @ ..] => {
            for name in names {
                match std::env::var(name) {
                    Ok(v) => println!("{name}={v}"),
                    Err(_) => println!("{name} unset"),
                }
            }
            0
        }
        ["pwd"] => {
            // A WASI program learns its directory from PWD: Rust std's
            // current_dir() is wasi-libc's, which starts at / whatever the
            // kernel says.
            println!("{}", std::env::var("PWD").unwrap_or_default());
            println!(
                "{}",
                std::env::current_dir()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default()
            );
            0
        }
        ["sleep", ms] => {
            std::thread::sleep(Duration::from_millis(ms.parse().unwrap()));
            0
        }
        ["touch-after", ms, path] => {
            std::thread::sleep(Duration::from_millis(ms.parse().unwrap()));
            std::fs::write(path, "alive\n").unwrap();
            0
        }
        ["connect", port, message] => {
            let stream = TcpStream::connect(("127.0.0.1", port.parse::<u16>().unwrap())).unwrap();
            (&stream)
                .write_all(format!("{message}\n").as_bytes())
                .unwrap();
            println!("{}", read_line(&stream));
            0
        }
        _ => 2,
    }
}
