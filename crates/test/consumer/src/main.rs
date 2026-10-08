//! The same source for both builds: `ureq::` is ureq natively and
//! wasix-ureq on WASI, and wasix-command's `Command` is std's natively.

use wasix_command::Command;

fn main() {
    let url = std::env::args().nth(1).unwrap_or_else(|| "https://example.com/".into());
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .try_proxy_from_env(true)
        .build();
    match agent.post(&url).set("Accept", "application/json").send_string("{}") {
        Ok(r) => println!("{} {}", r.status(), r.into_string().unwrap_or_default().len()),
        Err(ureq::Error::Status(code, r)) => println!("{code} {}", r.status_text()),
        Err(ureq::Error::Transport(t)) => println!("{:?} {t}", t.kind()),
    }
    let out = Command::new("true").output();
    println!("{:?}", out.map(|o| o.status.success()));
}
