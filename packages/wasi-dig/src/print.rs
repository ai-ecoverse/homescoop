//! dig's output: the banner, `->>HEADER<<-`, the sections with tab-aligned
//! records, and the statistics.

use crate::args::Opts;
use crate::transport::Reply;
use hickory_proto::op::{Message, OpCode};
use hickory_proto::rr::{RData, Record};
use std::fmt::Write;
use std::time::{SystemTime, UNIX_EPOCH};

fn rcode(code: u16) -> String {
    match code {
        0 => "NOERROR".into(),
        1 => "FORMERR".into(),
        2 => "SERVFAIL".into(),
        3 => "NXDOMAIN".into(),
        4 => "NOTIMP".into(),
        5 => "REFUSED".into(),
        6 => "YXDOMAIN".into(),
        7 => "YXRRSET".into(),
        8 => "NXRRSET".into(),
        9 => "NOTAUTH".into(),
        10 => "NOTZONE".into(),
        16 => "BADVERS".into(),
        n => format!("RESERVED{n}"),
    }
}

fn opcode(op: OpCode) -> &'static str {
    match op {
        OpCode::Query => "QUERY",
        OpCode::Status => "STATUS",
        OpCode::Notify => "NOTIFY",
        OpCode::Update => "UPDATE",
        _ => "RESERVED",
    }
}

/// Pad with tabs to `width` (tab stops every 8), at least one tab.
fn pad(s: &str, width: usize) -> String {
    let mut out = s.to_string();
    let mut col = s.chars().count();
    loop {
        out.push('\t');
        col = (col / 8 + 1) * 8;
        if col >= width {
            break;
        }
    }
    out
}

/// The record's data as dig prints it.
pub fn rdata(data: &RData) -> String {
    match data {
        // dig quotes every character-string of a TXT record.
        RData::TXT(txt) => txt
            .iter()
            .map(|s| {
                let mut q = String::from("\"");
                for &b in s.iter() {
                    match b {
                        b'"' | b'\\' => {
                            q.push('\\');
                            q.push(b as char);
                        }
                        0x20..=0x7e => q.push(b as char),
                        _ => {
                            let _ = write!(q, "\\{b:03}");
                        }
                    }
                }
                q.push('"');
                q
            })
            .collect::<Vec<_>>()
            .join(" "),
        RData::CAA(caa) => {
            let flags = if caa.issuer_critical() { 128 } else { 0 };
            let value = String::from_utf8_lossy(&caa.raw_value()).into_owned();
            format!("{flags} {} \"{}\"", caa.tag().as_str(), value.replace('"', "\\\""))
        }
        other => other.to_string(),
    }
}

pub fn record_line(r: &Record) -> String {
    format!(
        "{}{}\t{}\t{}\t{}",
        pad(&r.name().to_string(), 24),
        r.ttl(),
        r.dns_class(),
        r.record_type(),
        rdata(r.data())
    )
}

/// `Fri Oct 10 01:00:00 UTC 2026`.
fn when() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    const WD: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MO: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!(
        "{} {} {:02} {:02}:{:02}:{:02} UTC {}",
        WD[days.rem_euclid(7) as usize],
        MO[(m - 1) as usize],
        d,
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        y
    )
}

pub fn render(o: &Opts, msg: &Message, reply: &Reply) -> String {
    let mut out = String::new();
    if o.short {
        for r in msg.answers() {
            let _ = writeln!(out, "{}", rdata(r.data()));
        }
        return out;
    }
    if o.cmd {
        let _ = writeln!(out, "\n; <<>> DiG {} (wasi-dig) <<>> {}", env!("CARGO_PKG_VERSION"), o.argv.join(" "));
        let _ = writeln!(out, ";; global options: +cmd");
    }
    let edns = msg.extensions().as_ref();
    let mut code = u16::from(msg.response_code());
    if let Some(e) = edns {
        code |= u16::from(e.rcode_high()) << 4;
    }
    if o.comments {
        let mut flags = vec!["qr"];
        if msg.authoritative() {
            flags.push("aa");
        }
        if msg.truncated() {
            flags.push("tc");
        }
        if msg.recursion_desired() {
            flags.push("rd");
        }
        if msg.recursion_available() {
            flags.push("ra");
        }
        if msg.authentic_data() {
            flags.push("ad");
        }
        if msg.checking_disabled() {
            flags.push("cd");
        }
        let _ = writeln!(out, ";; Got answer:");
        let _ = writeln!(
            out,
            ";; ->>HEADER<<- opcode: {}, status: {}, id: {}",
            opcode(msg.op_code()),
            rcode(code),
            msg.id()
        );
        let _ = writeln!(
            out,
            ";; flags: {}; QUERY: {}, ANSWER: {}, AUTHORITY: {}, ADDITIONAL: {}",
            flags.join(" "),
            msg.queries().len(),
            msg.answers().len(),
            msg.name_servers().len(),
            msg.additionals().len() + usize::from(edns.is_some())
        );
        out.push('\n');
        if let (true, Some(e)) = (o.additional, edns) {
            let _ = writeln!(out, ";; OPT PSEUDOSECTION:");
            let do_flag = if e.flags().dnssec_ok { " do" } else { "" };
            let _ = writeln!(out, "; EDNS: version: {}, flags:{do_flag}; udp: {}", e.version(), e.max_payload());
        }
    }
    if o.question {
        if o.comments {
            let _ = writeln!(out, ";; QUESTION SECTION:");
        }
        for q in msg.queries() {
            let _ = writeln!(out, "{}{}\t{}", pad(&format!(";{}", q.name()), 32), q.query_class(), q.query_type());
        }
        if o.comments {
            out.push('\n');
        }
    }
    for (on, title, records) in [
        (o.answer, "ANSWER", msg.answers()),
        (o.authority, "AUTHORITY", msg.name_servers()),
        (o.additional, "ADDITIONAL", msg.additionals()),
    ] {
        if !on || records.is_empty() {
            continue;
        }
        if o.comments {
            let _ = writeln!(out, ";; {title} SECTION:");
        }
        for r in records {
            let _ = writeln!(out, "{}", record_line(r));
        }
        if o.comments {
            out.push('\n');
        }
    }
    if o.stats {
        let _ = writeln!(out, ";; Query time: {} msec", reply.elapsed.as_millis());
        let _ = writeln!(out, ";; SERVER: {}", reply.server);
        let _ = writeln!(out, ";; WHEN: {}", when());
        let _ = writeln!(out, ";; MSG SIZE  rcvd: {}", reply.bytes.len());
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_proto::rr::rdata::{CAA, MX, SOA, SRV, TXT};
    use hickory_proto::rr::{Name, RData, Record};
    use std::str::FromStr;

    fn line(data: RData) -> String {
        record_line(&Record::from_rdata(Name::from_str("example.com.").unwrap(), 300, data))
    }

    #[test]
    fn records_like_dig() {
        assert_eq!(line(RData::A("192.0.2.1".parse().unwrap())), "example.com.\t\t300\tIN\tA\t192.0.2.1");
        assert_eq!(
            line(RData::MX(MX::new(10, Name::from_str("mail.example.com.").unwrap()))),
            "example.com.\t\t300\tIN\tMX\t10 mail.example.com."
        );
        assert_eq!(
            line(RData::TXT(TXT::new(vec!["v=spf1 -all".into(), "say \"hi\"".into()]))),
            "example.com.\t\t300\tIN\tTXT\t\"v=spf1 -all\" \"say \\\"hi\\\"\""
        );
        assert_eq!(
            line(RData::SOA(SOA::new(
                Name::from_str("ns1.example.com.").unwrap(),
                Name::from_str("hostmaster.example.com.").unwrap(),
                2026101001,
                7200,
                3600,
                1209600,
                300
            ))),
            "example.com.\t\t300\tIN\tSOA\tns1.example.com. hostmaster.example.com. 2026101001 7200 3600 1209600 300"
        );
        assert_eq!(
            line(RData::SRV(SRV::new(0, 5, 5060, Name::from_str("sip.example.com.").unwrap()))),
            "example.com.\t\t300\tIN\tSRV\t0 5 5060 sip.example.com."
        );
        assert_eq!(
            line(RData::CAA(CAA::new_issue(false, Some(Name::from_str("letsencrypt.org").unwrap()), vec![]))),
            "example.com.\t\t300\tIN\tCAA\t0 issue \"letsencrypt.org\""
        );
    }

    #[test]
    fn padding() {
        assert_eq!(pad("a.", 24), "a.\t\t\t");
        assert_eq!(pad("example.com.", 24), "example.com.\t\t");
        assert_eq!(pad("a-very-long-name.example.com.", 24), "a-very-long-name.example.com.\t");
        assert_eq!(pad(";example.com.", 32), ";example.com.\t\t\t");
    }
}
