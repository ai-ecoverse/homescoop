//! dig's command line: `dig [@server] [-t type] [-c class] [-x addr]
//! [-p port] [name] [type] [class] [+option…]`.

use hickory_proto::rr::{DNSClass, Name, RecordType};
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

/// DNS over HTTPS when no `@server` is given.
pub const DEFAULT_DOH: &str = "https://cloudflare-dns.com/dns-query";

#[derive(Debug, Clone, PartialEq)]
pub enum Server {
    /// The DoH endpoint from `DIG_DOH_URL`, else [`DEFAULT_DOH`].
    Default,
    /// `@https://…` or `@http://…`: DNS over HTTPS (RFC 8484, POST).
    Doh(String),
    /// `@host`: DNS over TCP to host:port (slicc has no UDP).
    Tcp(String),
}

#[derive(Debug, Clone)]
pub struct Opts {
    pub server: Server,
    pub port: u16,
    pub name: Name,
    pub qtype: RecordType,
    pub qclass: DNSClass,
    pub short: bool,
    pub recurse: bool,
    pub edns: bool,
    pub dnssec: bool,
    pub timeout: Duration,
    pub tries: u32,
    pub cmd: bool,
    pub comments: bool,
    pub question: bool,
    pub answer: bool,
    pub authority: bool,
    pub additional: bool,
    pub stats: bool,
    /// The command line as typed, for the `; <<>> … <<>>` banner.
    pub argv: Vec<String>,
}

pub enum Parsed {
    Run(Box<Opts>),
    Help,
    Version,
}

/// Record types `dig NAME TYPE` takes as a bare word.
fn bare_type(word: &str) -> Option<RecordType> {
    let up = word.to_ascii_uppercase();
    match up.as_str() {
        "A" | "AAAA" | "ANY" | "CAA" | "CNAME" | "DNSKEY" | "DS" | "HINFO" | "HTTPS" | "MX"
        | "NAPTR" | "NS" | "NULL" | "OPT" | "PTR" | "SOA" | "SRV" | "SSHFP" | "SVCB" | "TLSA"
        | "TXT" | "AXFR" | "IXFR" => RecordType::from_str(&up).ok(),
        _ => up.strip_prefix("TYPE").and_then(|n| n.parse::<u16>().ok()).map(RecordType::from),
    }
}

fn bare_class(word: &str) -> Option<DNSClass> {
    match word.to_ascii_uppercase().as_str() {
        "IN" => Some(DNSClass::IN),
        "CH" => Some(DNSClass::CH),
        "HS" => Some(DNSClass::HS),
        _ => None,
    }
}

fn parse_type(v: &str) -> Result<RecordType, String> {
    bare_type(v).ok_or_else(|| format!("invalid type: {v}"))
}

fn parse_name(v: &str) -> Result<Name, String> {
    let mut n = Name::from_str(v).map_err(|e| format!("'{v}' is not a legal name ({e})"))?;
    n.set_fqdn(true);
    Ok(n)
}

/// The in-addr.arpa / ip6.arpa name for `-x`.
pub fn reverse_name(addr: &str) -> Result<Name, String> {
    let ip: IpAddr = addr.parse().map_err(|_| format!("'{addr}' is not a legal IP address"))?;
    let s = match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            format!("{}.{}.{}.{}.in-addr.arpa.", o[3], o[2], o[1], o[0])
        }
        IpAddr::V6(v6) => {
            let mut s = String::new();
            for b in v6.octets().iter().rev() {
                s.push_str(&format!("{:x}.{:x}.", b & 0xf, b >> 4));
            }
            s + "ip6.arpa."
        }
    };
    parse_name(&s)
}

fn plus_option(o: &mut Opts, opt: &str) -> Result<(), String> {
    let (key, val) = match opt.split_once('=') {
        Some((k, v)) => (k, Some(v)),
        None => (opt, None),
    };
    let (on, key) = match key.strip_prefix("no") {
        Some(rest) if !rest.is_empty() => (false, rest),
        _ => (true, key),
    };
    // dig accepts any unambiguous prefix; these are the spellings in use.
    match key {
        "short" => o.short = on,
        "tcp" | "vc" => {
            if !on {
                return Err("+notcp: slicc's kernel has no UDP, so DNS goes over TCP or HTTPS".into());
            }
        }
        "https" => match val {
            Some(url) if !url.is_empty() => o.server = Server::Doh(url.to_string()),
            _ if on => {
                if !matches!(o.server, Server::Doh(_)) {
                    o.server = Server::Default;
                }
            }
            _ => {}
        },
        "rec" | "recurse" => o.recurse = on,
        "edns" => o.edns = on,
        "dnssec" => {
            o.dnssec = on;
            if on {
                o.edns = true;
            }
        }
        "time" | "timeout" => {
            let secs: u64 = val
                .and_then(|v| v.parse().ok())
                .ok_or_else(|| format!("+{opt}: needs a number of seconds"))?;
            o.timeout = Duration::from_secs(secs.max(1));
        }
        "tries" | "retry" => {
            let n: u32 = val
                .and_then(|v| v.parse().ok())
                .ok_or_else(|| format!("+{opt}: needs a number"))?;
            o.tries = if key == "retry" { n + 1 } else { n.max(1) };
        }
        "cmd" => o.cmd = on,
        "comments" => o.comments = on,
        "question" => o.question = on,
        "answer" => o.answer = on,
        "authority" => o.authority = on,
        "additional" => o.additional = on,
        "stats" => o.stats = on,
        "all" => {
            o.cmd = on;
            o.comments = on;
            o.question = on;
            o.answer = on;
            o.authority = on;
            o.additional = on;
            o.stats = on;
        }
        "search" | "defname" | "ignore" | "fail" | "besteffort" | "ttlid" | "cl" | "class"
        | "ttlunits" | "multiline" | "identify" | "nsid" | "cookie" | "adflag" | "cdflag"
        | "aaonly" | "aaflag" | "bufsize" | "idnin" | "idnout" | "showsearch" | "crypto" => {}
        _ => return Err(format!("Invalid option: +{opt}")),
    }
    Ok(())
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Parsed, String> {
    let argv: Vec<String> = args.into_iter().collect();
    let mut o = Opts {
        server: Server::Default,
        port: 0,
        name: Name::root(),
        qtype: RecordType::A,
        qclass: DNSClass::IN,
        short: false,
        recurse: true,
        edns: true,
        dnssec: false,
        timeout: Duration::from_secs(5),
        tries: 2,
        cmd: true,
        comments: true,
        question: true,
        answer: true,
        authority: true,
        additional: true,
        stats: true,
        argv: argv.clone(),
    };
    let mut name: Option<Name> = None;
    let mut qtype: Option<RecordType> = None;
    let mut it = argv.iter().peekable();
    while let Some(arg) = it.next() {
        let mut value = |flag: &str| -> Result<String, String> {
            let inline = &arg[flag.len()..];
            if !inline.is_empty() {
                return Ok(inline.to_string());
            }
            it.next().cloned().ok_or_else(|| format!("option {flag} needs an argument"))
        };
        if let Some(server) = arg.strip_prefix('@') {
            if server.is_empty() {
                return Err("@ needs a server".into());
            }
            o.server = if server.starts_with("https://") || server.starts_with("http://") {
                Server::Doh(server.to_string())
            } else {
                Server::Tcp(server.to_string())
            };
        } else if let Some(opt) = arg.strip_prefix('+') {
            plus_option(&mut o, opt)?;
        } else if arg == "-h" || arg == "--help" {
            return Ok(Parsed::Help);
        } else if arg == "-v" || arg == "--version" {
            return Ok(Parsed::Version);
        } else if arg.starts_with("-t") {
            qtype = Some(parse_type(&value("-t")?)?);
        } else if arg.starts_with("-c") {
            let v = value("-c")?;
            o.qclass = bare_class(&v).ok_or_else(|| format!("invalid class: {v}"))?;
        } else if arg.starts_with("-x") {
            name = Some(reverse_name(&value("-x")?)?);
            qtype.get_or_insert(RecordType::PTR);
        } else if arg.starts_with("-p") {
            let v = value("-p")?;
            o.port = v.parse().map_err(|_| format!("invalid port: {v}"))?;
        } else if arg.starts_with("-q") {
            name = Some(parse_name(&value("-q")?)?);
        } else if arg == "-4" || arg == "-6" {
        } else if arg.starts_with('-') && arg.len() > 1 {
            return Err(format!("Invalid option: {arg}"));
        } else if let (None, Some(t)) = (&qtype, bare_type(arg)) {
            // As in dig, a bare type keyword is the type wherever it is.
            qtype = Some(t);
        } else if let Some(c) = bare_class(arg) {
            o.qclass = c;
        } else if name.is_none() {
            name = Some(parse_name(arg)?);
        } else if qtype.is_none() {
            qtype = Some(parse_type(arg)?);
        } else {
            return Err(format!("extra argument: {arg}"));
        }
    }
    match name {
        Some(n) => {
            o.name = n;
            o.qtype = qtype.unwrap_or(RecordType::A);
        }
        // Like dig: no name asks the root for its name servers.
        None => o.qtype = qtype.unwrap_or(RecordType::NS),
    }
    if o.short {
        o.cmd = false;
        o.comments = false;
        o.question = false;
        o.authority = false;
        o.additional = false;
        o.stats = false;
    }
    Ok(Parsed::Run(Box::new(o)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Opts {
        match parse(args.iter().map(|s| s.to_string())).unwrap() {
            Parsed::Run(o) => *o,
            _ => panic!("not a run"),
        }
    }

    #[test]
    fn name_and_type() {
        let o = run(&["example.com", "MX"]);
        assert_eq!(o.name.to_string(), "example.com.");
        assert_eq!(o.qtype, RecordType::MX);
        assert_eq!(o.server, Server::Default);
        let o = run(&["-t", "aaaa", "example.com"]);
        assert_eq!(o.qtype, RecordType::AAAA);
        let o = run(&["-tTXT", "example.com"]);
        assert_eq!(o.qtype, RecordType::TXT);
        let o = run(&["mx", "example.com"]);
        assert_eq!((o.name.to_string().as_str(), o.qtype), ("example.com.", RecordType::MX));
        let o = run(&[]);
        assert_eq!((o.name.to_string().as_str(), o.qtype), (".", RecordType::NS));
    }

    #[test]
    fn servers() {
        assert_eq!(run(&["@100.100.100.100", "x"]).server, Server::Tcp("100.100.100.100".into()));
        assert_eq!(
            run(&["@https://dns.test/q", "x"]).server,
            Server::Doh("https://dns.test/q".into())
        );
        assert_eq!(
            run(&["+https=https://d.test/dns-query", "x"]).server,
            Server::Doh("https://d.test/dns-query".into())
        );
        assert_eq!(run(&["@ns.test", "-p", "5353", "x"]).port, 5353);
    }

    #[test]
    fn reverse() {
        let o = run(&["-x", "192.0.2.1"]);
        assert_eq!(o.name.to_string(), "1.2.0.192.in-addr.arpa.");
        assert_eq!(o.qtype, RecordType::PTR);
        let o = run(&["-x", "2001:db8::1"]);
        assert!(o.name.to_string().starts_with("1.0.0.0.0.0.0.0"));
        assert!(o.name.to_string().ends_with("8.b.d.0.1.0.0.2.ip6.arpa."));
    }

    #[test]
    fn plus_options() {
        let o = run(&["+short", "x"]);
        assert!(o.short && o.answer && !o.question && !o.stats);
        let o = run(&["+noall", "+answer", "x"]);
        assert!(o.answer && !o.question && !o.comments && !o.cmd);
        let o = run(&["+norec", "+time=2", "+tries=1", "x"]);
        assert!(!o.recurse);
        assert_eq!((o.timeout, o.tries), (Duration::from_secs(2), 1));
        assert!(parse(["+notcp".to_string()]).is_err());
        assert!(parse(["+bogus".to_string()]).is_err());
    }
}
