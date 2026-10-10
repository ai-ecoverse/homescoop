//! dig for slicc's kernel (homescoop#101). The kernel has no UDP, so a
//! query goes over DNS over HTTPS through the realm proxy (the default,
//! or `@https://…`) or over DNS over TCP to `@server` (a tailnet resolver
//! through the uplink, or a resolver on the realm's loopback).

mod args;
mod print;
mod transport;

use args::{Opts, Parsed};
use hickory_proto::op::{Edns, Message, MessageType, OpCode, Query};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::process::ExitCode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

const USAGE: &str = "\
Usage:  dig [@server] [-t type] [-c class] [-x addr] [-p port] [name] [type] [+option...]

Servers (slicc has no UDP):
  (none)           DNS over HTTPS to $DIG_DOH_URL, else https://cloudflare-dns.com/dns-query
  @https://host/p  DNS over HTTPS to that endpoint (through the realm proxy)
  @host            DNS over TCP to host:53 (-p port); e.g. a tailnet resolver
Options:
  -t type          A AAAA MX TXT CNAME NS SOA SRV PTR CAA ANY … (default A; NS for no name)
  -x addr          reverse lookup (PTR in in-addr.arpa / ip6.arpa)
  -c class         IN (default), CH, HS
  +short           only the answer data
  +[no]all +[no]cmd +[no]comments +[no]question +[no]answer +[no]authority
  +[no]additional +[no]stats    what to print
  +[no]recurse +[no]edns +[no]dnssec +time=N +tries=N +https[=url] +tcp
  -h, -v           help, version
";

fn query_id(doh: bool) -> u16 {
    // RFC 8484 4.1: DoH clients use id 0 so responses cache well.
    if doh {
        return 0;
    }
    let mut h = RandomState::new().build_hasher();
    h.write_u64(0x5eed);
    h.finish() as u16
}

fn build(o: &Opts, id: u16) -> Result<Vec<u8>, String> {
    let mut m = Message::new();
    m.set_id(id);
    m.set_message_type(MessageType::Query);
    m.set_op_code(OpCode::Query);
    m.set_recursion_desired(o.recurse);
    let mut q = Query::query(o.name.clone(), o.qtype);
    q.set_query_class(o.qclass);
    m.add_query(q);
    if o.edns {
        let mut e = Edns::new();
        e.set_max_payload(1232);
        e.set_version(0);
        e.set_dnssec_ok(o.dnssec);
        m.set_edns(e);
    }
    m.to_vec().map_err(|e| e.to_string())
}

fn run(o: &Opts) -> Result<String, (u8, String)> {
    let doh = transport::doh_url(&o.server).is_some();
    let id = query_id(doh);
    let wire = build(o, id).map_err(|e| (10, format!("dig: building the query: {e}")))?;
    let mut err = String::new();
    for _ in 0..o.tries.max(1) {
        match transport::send(o, &wire) {
            Ok(reply) => {
                let msg = Message::from_vec(&reply.bytes).map_err(|e| {
                    (9, format!(";; Got bad packet: {e}\n{} bytes from {}", reply.bytes.len(), reply.server))
                })?;
                if msg.id() != id || msg.message_type() != MessageType::Response {
                    return Err((9, format!(";; reply from {} does not match the query", reply.server)));
                }
                return Ok(print::render(o, &msg, &reply));
            }
            Err(e) => err = e,
        }
    }
    Err((
        9,
        format!(
            ";; communications error to {}: {err}\n;; no servers could be reached",
            transport::describe(o)
        ),
    ))
}

fn main() -> ExitCode {
    let opts = match args::parse(std::env::args().skip(1)) {
        Ok(Parsed::Run(o)) => o,
        Ok(Parsed::Help) => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Ok(Parsed::Version) => {
            println!("DiG {VERSION} (wasi-dig, @ai-ecoverse/wasi-dig)");
            return ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("dig: {e}");
            eprint!("{USAGE}");
            return ExitCode::from(1);
        }
    };
    match run(&opts) {
        Ok(out) => {
            print!("{out}");
            ExitCode::SUCCESS
        }
        Err((code, msg)) => {
            eprintln!("{msg}");
            ExitCode::from(code)
        }
    }
}
