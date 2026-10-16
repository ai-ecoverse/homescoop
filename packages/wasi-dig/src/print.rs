//! dig's output: the banner, `->>HEADER<<-`, the sections with tab-aligned
//! records, and the statistics.

use crate::args::Opts;
use crate::transport::Reply;
use hickory_proto::op::{Message, OpCode};
use crate::present;
use hickory_proto::rr::{DNSClass, Name, RData, Record, RecordType};
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

/// The record's data as dig prints it (`crypto`: false for `+nocrypto`).
pub fn rdata(data: &RData, crypto: bool) -> String {
    match data {
        // dig quotes every character-string of a TXT record.
        RData::TXT(txt) => txt
            .txt_data
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
            let flags = if caa.issuer_critical { 128 } else { 0 };
            let value = String::from_utf8_lossy(&caa.value).into_owned();
            format!("{flags} {} \"{}\"", caa.tag.as_str(), value.replace('"', "\\\""))
        }
        RData::CNAME(n) => present::name(&n.0),
        RData::NS(n) => present::name(&n.0),
        RData::PTR(n) => present::name(&n.0),
        RData::MX(mx) => format!("{} {}", mx.preference, present::name(&mx.exchange)),
        RData::SRV(srv) => {
            format!("{} {} {} {}", srv.priority, srv.weight, srv.port, present::name(&srv.target))
        }
        RData::SOA(soa) => format!(
            "{} {} {} {} {} {} {}",
            present::name(&soa.mname),
            present::name(&soa.rname),
            soa.serial,
            soa.refresh as u32,
            soa.retry as u32,
            soa.expire as u32,
            soa.minimum
        ),
        RData::HTTPS(https) => present::svcb(&https.0),
        RData::SVCB(svcb) => present::svcb(svcb),
        // RFC 3597, as BIND prints NULL and the types it doesn't know.
        RData::NULL(null) => present::unknown(&null.anything),
        RData::Unknown { code, rdata } => {
            let bytes = &rdata.anything;
            present::dnssec(u16::from(*code), bytes, crypto).unwrap_or_else(|| present::unknown(bytes))
        }
        other => other.to_string(),
    }
}

/// One record in dig's columns: TTL at 24, class at 32, type at 40, rdata
/// at 48, as BIND's masterdump lays them out (tabs, then spaces after a
/// field that is wider than its column).
pub fn record_line(r: &Record, crypto: bool) -> String {
    let mut out = present::name(&r.name);
    let mut col = out.chars().count();
    for (field, to) in [
        (r.ttl.to_string(), 24),
        (present::class_name(u16::from(r.dns_class)), 32),
        (present::type_name(u16::from(r.record_type())), 40),
        (rdata(&r.data, crypto), 48),
    ] {
        present::indent(&mut out, &mut col, to);
        col += field.chars().count();
        out.push_str(&field);
    }
    out
}

/// A question as BIND prints it: `;`, then the name, class at 32 and type
/// at 40, counted without the `;` (message.c prints it before
/// `dns_master_questiontotext`).
fn question_line(name: &Name, class: DNSClass, qtype: RecordType) -> String {
    let mut out = String::from(";");
    let owner = present::name(name);
    let mut col = owner.chars().count();
    out.push_str(&owner);
    for (field, to) in [(present::class_name(u16::from(class)), 32), (present::type_name(u16::from(qtype)), 40)] {
        present::indent(&mut out, &mut col, to);
        col += field.chars().count();
        out.push_str(&field);
    }
    out
}

/// `Fri Oct 10 01:00:00 UTC 2026`.
fn when() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d, hh, mm, ss) = present::civil(secs);
    const WD: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MO: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!(
        "{} {} {:02} {:02}:{:02}:{:02} UTC {}",
        WD[(secs / 86_400 % 7) as usize],
        MO[(m - 1) as usize],
        d,
        hh,
        mm,
        ss,
        y
    )
}

pub fn render(o: &Opts, msg: &Message, reply: &Reply) -> String {
    let mut out = String::new();
    if o.short {
        for r in &msg.answers {
            let _ = writeln!(out, "{}", rdata(&r.data, o.crypto));
        }
        return out;
    }
    if o.cmd {
        let _ = writeln!(out, "\n; <<>> DiG {} (wasi-dig) <<>> {}", env!("CARGO_PKG_VERSION"), o.argv.join(" "));
        let _ = writeln!(out, ";; global options: +cmd");
    }
    let edns = msg.edns.as_ref();
    let mut code = u16::from(msg.response_code);
    if let Some(e) = edns {
        code |= u16::from(e.rcode_high()) << 4;
    }
    if o.comments {
        let mut flags = vec!["qr"];
        if msg.authoritative {
            flags.push("aa");
        }
        if msg.truncation {
            flags.push("tc");
        }
        if msg.recursion_desired {
            flags.push("rd");
        }
        if msg.recursion_available {
            flags.push("ra");
        }
        if msg.authentic_data {
            flags.push("ad");
        }
        if msg.checking_disabled {
            flags.push("cd");
        }
        let _ = writeln!(out, ";; Got answer:");
        let _ = writeln!(
            out,
            ";; ->>HEADER<<- opcode: {}, status: {}, id: {}",
            opcode(msg.op_code),
            rcode(code),
            msg.id
        );
        let _ = writeln!(
            out,
            ";; flags: {}; QUERY: {}, ANSWER: {}, AUTHORITY: {}, ADDITIONAL: {}",
            flags.join(" "),
            msg.queries.len(),
            msg.answers.len(),
            msg.authorities.len(),
            msg.additionals.len() + usize::from(edns.is_some())
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
        for q in &msg.queries {
            let _ = writeln!(out, "{}", question_line(q.name(), q.query_class(), q.query_type()));
        }
        if o.comments {
            out.push('\n');
        }
    }
    for (on, title, records) in [
        (o.answer, "ANSWER", &msg.answers),
        (o.authority, "AUTHORITY", &msg.authorities),
        (o.additional, "ADDITIONAL", &msg.additionals),
    ] {
        if !on || records.is_empty() {
            continue;
        }
        if o.comments {
            let _ = writeln!(out, ";; {title} SECTION:");
        }
        for r in records {
            let _ = writeln!(out, "{}", record_line(r, o.crypto));
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
    use hickory_proto::rr::rdata::svcb::{Alpn, IpHint, Mandatory, SvcParamKey, SvcParamValue, SVCB, Unknown};
    use hickory_proto::rr::rdata::{A, CAA, HTTPS, MX, NULL, SOA, SRV, TXT};
    use hickory_proto::rr::{Name, RData, Record};
    use std::str::FromStr;

    fn line(data: RData) -> String {
        record_line(&Record::from_rdata(Name::from_str("example.com.").unwrap(), 300, data), true)
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
    fn https_and_unknown_like_bind() {
        // homescoop#403: hickory printed `1 . alpn=h2,` and `Unknown\tAQIDBA==`.
        let https = |params| RData::HTTPS(HTTPS(SVCB::new(1, Name::root(), params)));
        assert_eq!(
            line(https(vec![(SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h2".into()])))])),
            "example.com.\t\t300\tIN\tHTTPS\t1 . alpn=\"h2\""
        );
        assert_eq!(
            rdata(
                &https(vec![
                    (SvcParamKey::Mandatory, SvcParamValue::Mandatory(Mandatory(vec![SvcParamKey::Alpn, SvcParamKey::Ipv4Hint]))),
                    (SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into(), "h2".into(), "a,b\\c".into()]))),
                    (SvcParamKey::NoDefaultAlpn, SvcParamValue::NoDefaultAlpn),
                    (SvcParamKey::Port, SvcParamValue::Port(8443)),
                    (
                        SvcParamKey::Ipv4Hint,
                        SvcParamValue::Ipv4Hint(IpHint(vec![A::new(192, 0, 2, 1), A::new(192, 0, 2, 2)]))
                    ),
                    (SvcParamKey::Unknown(7), SvcParamValue::Unknown(Unknown(b"/q{?dns}".to_vec()))),
                ]),
                true
            ),
            "1 . mandatory=alpn,ipv4hint alpn=\"h3,h2,a\\\\,b\\\\\\\\c\" no-default-alpn port=8443 ipv4hint=192.0.2.1,192.0.2.2 key7=\"/q{?dns}\""
        );
        let unknown = Record::from_rdata(
            Name::from_str("unknown.test.").unwrap(),
            60,
            RData::Unknown { code: RecordType::Unknown(999), rdata: NULL::with(vec![1, 2, 3, 4]) },
        );
        assert_eq!(record_line(&unknown, true), "unknown.test.\t\t60\tIN\tTYPE999\t\\# 4 01020304");
        assert_eq!(rdata(&unknown.data, true), "\\# 4 01020304");
    }

    #[test]
    fn columns_and_questions() {
        let long = Record::from_rdata(
            Name::from_str("a-very-long-owner-name-for-testing.github.io.").unwrap(),
            3600,
            RData::A("185.199.110.153".parse().unwrap()),
        );
        assert_eq!(record_line(&long, true), "a-very-long-owner-name-for-testing.github.io. 3600 IN A\t185.199.110.153");
        let q = |n: &str, t| question_line(&Name::from_str(n).unwrap(), DNSClass::IN, t);
        assert_eq!(q("example.com.", RecordType::A), ";example.com.\t\t\tIN\tA");
        // BIND counts the columns without the ';'.
        assert_eq!(q("abcdefghijklmn.", RecordType::A), ";abcdefghijklmn.\t\t\tIN\tA");
        assert_eq!(q("a-name-that-is-wider-than-32.example.", RecordType::AAAA), ";a-name-that-is-wider-than-32.example. IN AAAA");
        assert_eq!(q("unknown.test.", RecordType::Unknown(999)), ";unknown.test.\t\t\tIN\tTYPE999");
    }
}
