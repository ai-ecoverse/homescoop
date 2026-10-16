//! BIND's presentation format (what `dig` prints) for the parts hickory's
//! `Display` gets differently: names, type and class mnemonics, unknown
//! types (RFC 3597), SVCB/HTTPS (RFC 9460) and the DNSSEC types (RFC 4034,
//! RFC 5155), whose rdata hickory hands over as raw bytes when it is built
//! without its `dnssec` feature. Each function follows the BIND 9.20
//! source it names, with dig's style: no multiline, hex and base64 split
//! with a space every 56 characters.

use hickory_proto::rr::rdata::svcb::{SvcParamKey, SvcParamValue, SVCB};
use hickory_proto::rr::Name;
use std::fmt::Write;

/// dig's split width for hex and base64 outside `+multiline`
/// (`dns_rdata_tofmttext`: 60, less 2).
const WORD: usize = 58;

/// `dns_name_totext`: every label, absolute, with BIND's escapes.
pub fn name(n: &Name) -> String {
    if n.is_root() {
        return ".".into();
    }
    let mut out = String::new();
    for label in n.iter() {
        label_text(label, &mut out);
        out.push('.');
    }
    out
}

fn label_text(label: &[u8], out: &mut String) {
    for &c in label {
        match c {
            b'"' | b'(' | b')' | b'.' | b';' | b'\\' | b'@' | b'$' => {
                out.push('\\');
                out.push(c as char);
            }
            0x21..=0x7e => out.push(c as char),
            _ => {
                let _ = write!(out, "\\{c:03}");
            }
        }
    }
}

/// An uncompressed name at `rd[*at..]` (RRSIG's signer, NSEC's next name,
/// DNAME's target: RFC 4034 and RFC 6672 forbid compressing them).
fn wire_name(rd: &[u8], at: &mut usize) -> Option<String> {
    let mut out = String::new();
    loop {
        let len = *rd.get(*at)? as usize;
        *at += 1;
        if len == 0 {
            break;
        }
        if len > 63 {
            return None;
        }
        label_text(rd.get(*at..*at + len)?, &mut out);
        out.push('.');
        *at += len;
    }
    if out.is_empty() {
        out.push('.');
    }
    Some(out)
}

/// BIND 9.20's type mnemonics (its rdata/*/<name>_<code>.c and meta-types).
const TYPES: &[(u16, &str)] = &[
    (1, "A"),
    (2, "NS"),
    (3, "MD"),
    (4, "MF"),
    (5, "CNAME"),
    (6, "SOA"),
    (7, "MB"),
    (8, "MG"),
    (9, "MR"),
    (10, "NULL"),
    (11, "WKS"),
    (12, "PTR"),
    (13, "HINFO"),
    (14, "MINFO"),
    (15, "MX"),
    (16, "TXT"),
    (17, "RP"),
    (18, "AFSDB"),
    (19, "X25"),
    (20, "ISDN"),
    (21, "RT"),
    (22, "NSAP"),
    (23, "NSAP-PTR"),
    (24, "SIG"),
    (25, "KEY"),
    (26, "PX"),
    (27, "GPOS"),
    (28, "AAAA"),
    (29, "LOC"),
    (30, "NXT"),
    (31, "EID"),
    (32, "NIMLOC"),
    (33, "SRV"),
    (34, "ATMA"),
    (35, "NAPTR"),
    (36, "KX"),
    (37, "CERT"),
    (38, "A6"),
    (39, "DNAME"),
    (40, "SINK"),
    (41, "OPT"),
    (42, "APL"),
    (43, "DS"),
    (44, "SSHFP"),
    (45, "IPSECKEY"),
    (46, "RRSIG"),
    (47, "NSEC"),
    (48, "DNSKEY"),
    (49, "DHCID"),
    (50, "NSEC3"),
    (51, "NSEC3PARAM"),
    (52, "TLSA"),
    (53, "SMIMEA"),
    (55, "HIP"),
    (56, "NINFO"),
    (57, "RKEY"),
    (58, "TALINK"),
    (59, "CDS"),
    (60, "CDNSKEY"),
    (61, "OPENPGPKEY"),
    (62, "CSYNC"),
    (63, "ZONEMD"),
    (64, "SVCB"),
    (65, "HTTPS"),
    (66, "DSYNC"),
    (67, "HHIT"),
    (68, "BRID"),
    (99, "SPF"),
    (104, "NID"),
    (105, "L32"),
    (106, "L64"),
    (107, "LP"),
    (108, "EUI48"),
    (109, "EUI64"),
    (249, "TKEY"),
    (250, "TSIG"),
    (251, "IXFR"),
    (252, "AXFR"),
    (253, "MAILB"),
    (254, "MAILA"),
    (255, "ANY"),
    (256, "URI"),
    (257, "CAA"),
    (258, "AVC"),
    (259, "DOA"),
    (260, "AMTRELAY"),
    (261, "RESINFO"),
    (262, "WALLET"),
    (32768, "TA"),
    (32769, "DLV"),
];

/// `dns_rdatatype_totext`: BIND's mnemonic, else `TYPE<n>`.
pub fn type_name(code: u16) -> String {
    match TYPES.iter().find(|(c, _)| *c == code) {
        Some((_, m)) => (*m).into(),
        None => format!("TYPE{code}"),
    }
}

/// `dns_rdatatype_fromtext`: a mnemonic (any case) or `TYPE<n>`.
pub fn type_code(word: &str) -> Option<u16> {
    let up = word.to_ascii_uppercase();
    if let Some((c, _)) = TYPES.iter().find(|(_, m)| *m == up) {
        return Some(*c);
    }
    up.strip_prefix("TYPE").filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())).and_then(|n| n.parse().ok())
}

/// `dns_rdataclass_totext`.
pub fn class_name(code: u16) -> String {
    match code {
        1 => "IN".into(),
        3 => "CH".into(),
        4 => "HS".into(),
        254 => "NONE".into(),
        255 => "ANY".into(),
        n => format!("CLASS{n}"),
    }
}

/// `isc_hex_totext`: uppercase, a space after every `word` characters.
fn hex(data: &[u8], word: usize) -> String {
    let mut out = String::new();
    let mut loops = 0;
    for (i, b) in data.iter().enumerate() {
        let _ = write!(out, "{b:02X}");
        loops += 1;
        if i + 1 < data.len() && (loops + 1) * 2 >= word {
            loops = 0;
            out.push(' ');
        }
    }
    out
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `isc_base64_totext`: a space after every `word` characters (rounded
/// down to whole quartets); `None` for no splitting.
fn base64(data: &[u8], word: Option<usize>) -> String {
    let word = word.unwrap_or(usize::MAX).max(4);
    let mut out = String::new();
    let mut loops = 0;
    let mut rest = data;
    while rest.len() > 2 {
        let n = (u32::from(rest[0]) << 16) | (u32::from(rest[1]) << 8) | u32::from(rest[2]);
        for shift in [18, 12, 6, 0] {
            out.push(B64[(n >> shift) as usize & 63] as char);
        }
        rest = &rest[3..];
        loops += 1;
        if !rest.is_empty() && (loops + 1) * 4 >= word {
            loops = 0;
            out.push(' ');
        }
    }
    match rest {
        [a] => {
            out.push(B64[(a >> 2) as usize] as char);
            out.push(B64[((a & 3) << 4) as usize] as char);
            out.push_str("==");
        }
        [a, b] => {
            out.push(B64[(a >> 2) as usize] as char);
            out.push(B64[(((a & 3) << 4) | (b >> 4)) as usize] as char);
            out.push(B64[((b & 15) << 2) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

/// `isc_base32hexnp_totext`: RFC 4648 base32hex, uppercase, no padding
/// (NSEC3's next hashed owner name).
fn base32hex(data: &[u8]) -> String {
    const ALPHA: &[u8; 32] = b"0123456789ABCDEFGHIJKLMNOPQRSTUV";
    let mut out = String::new();
    let (mut acc, mut bits) = (0u32, 0);
    for &b in data {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHA[(acc >> bits) as usize & 31] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHA[(acc << (5 - bits)) as usize & 31] as char);
    }
    out
}

/// `dns_time32_totext`: `YYYYMMDDHHMMSS`, UTC.
pub fn time32(t: u32) -> String {
    let (y, m, d, hh, mm, ss) = civil(u64::from(t));
    format!("{y:04}{m:02}{d:02}{hh:02}{mm:02}{ss:02}")
}

/// Civil UTC date and time from seconds since 1970 (Howard Hinnant).
pub fn civil(secs: u64) -> (i64, u32, u32, u64, u64, u64) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

/// RFC 4034 Appendix B: the key tag of a DNSKEY's rdata.
pub fn key_tag(rd: &[u8]) -> u16 {
    if rd.get(3) == Some(&1) {
        // RSA/MD5: the most significant 16 bits of the least significant 24.
        let n = rd.len();
        return if n >= 4 { u16::from_be_bytes([rd[n - 3], rd[n - 2]]) } else { 0 };
    }
    let mut acc: u32 = 0;
    for (i, &b) in rd.iter().enumerate() {
        acc += if i & 1 == 1 { u32::from(b) } else { u32::from(b) << 8 };
    }
    acc += acc >> 16;
    (acc & 0xffff) as u16
}

/// RFC 3597: `\# <length> <hex>`.
pub fn unknown(rd: &[u8]) -> String {
    if rd.is_empty() {
        return "\\# 0".into();
    }
    format!("\\# {} {}", rd.len(), hex(rd, WORD))
}

fn u16_at(rd: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*rd.get(at)?, *rd.get(at + 1)?]))
}

fn u32_at(rd: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*rd.get(at)?, *rd.get(at + 1)?, *rd.get(at + 2)?, *rd.get(at + 3)?]))
}

/// `typemap_totext`: the types in an NSEC/NSEC3/CSYNC type bitmap.
fn typemap(rd: &[u8]) -> Option<String> {
    let mut types = Vec::new();
    let mut i = 0;
    while i < rd.len() {
        let window = u16::from(*rd.get(i)?);
        let len = *rd.get(i + 1)? as usize;
        if len == 0 || len > 32 {
            return None;
        }
        let bits = rd.get(i + 2..i + 2 + len)?;
        for (j, &byte) in bits.iter().enumerate() {
            for k in 0..8 {
                if byte & (0x80 >> k) != 0 {
                    types.push(type_name(window * 256 + (j as u16) * 8 + k));
                }
            }
        }
        i += 2 + len;
    }
    Some(types.join(" "))
}

/// The DNSSEC types from their raw rdata, as BIND's `totext_*` print them,
/// or `None` when hickory doesn't hand them over raw or they are
/// malformed (the caller then prints RFC 3597's form).
pub fn dnssec(code: u16, rd: &[u8], crypto: bool) -> Option<String> {
    match code {
        // DNSKEY, CDNSKEY, KEY, RKEY: generic_totext_key.
        48 | 60 | 25 | 57 => {
            let flags = u16_at(rd, 0)?;
            let (proto, alg) = (*rd.get(2)?, *rd.get(3)?);
            let mut out = format!("{flags} {proto} {alg}");
            // KEY with the NOKEY type has no key material.
            if code == 25 && flags & 0xc000 == 0xc000 {
                return Some(out);
            }
            out.push(' ');
            if crypto {
                out.push_str(&base64(&rd[4..], Some(WORD)));
            } else {
                let _ = write!(out, "[key id = {}]", key_tag(rd));
            }
            Some(out)
        }
        // DS, CDS, DLV, TA: generic_totext_ds.
        43 | 59 | 32769 | 32768 => {
            let tag = u16_at(rd, 0)?;
            let (alg, digest) = (*rd.get(2)?, *rd.get(3)?);
            let body = if crypto { hex(&rd[4..], WORD) } else { "[omitted]".into() };
            Some(format!("{tag} {alg} {digest} {body}"))
        }
        // RRSIG, SIG: totext_rrsig.
        46 | 24 => {
            let covered = u16_at(rd, 0)?;
            let (alg, labels) = (*rd.get(2)?, *rd.get(3)?);
            let ttl = u32_at(rd, 4)?;
            let (exp, inc) = (u32_at(rd, 8)?, u32_at(rd, 12)?);
            let tag = u16_at(rd, 16)?;
            let mut at = 18;
            let signer = wire_name(rd, &mut at)?;
            let covered = if covered == 0 { "TYPE0".into() } else { type_name(covered) };
            let sig = if crypto { base64(&rd[at..], Some(WORD)) } else { "[omitted]".into() };
            Some(format!(
                "{covered} {alg} {labels} {ttl} {} {} {tag} {signer} {sig}",
                time32(exp),
                time32(inc)
            ))
        }
        // NSEC: totext_nsec.
        47 => {
            let mut at = 0;
            let next = wire_name(rd, &mut at)?;
            let types = typemap(&rd[at..])?;
            Some(if types.is_empty() { next } else { format!("{next} {types}") })
        }
        // NSEC3: totext_nsec3.
        50 => {
            let (alg, flags) = (*rd.first()?, *rd.get(1)?);
            let iterations = u16_at(rd, 2)?;
            let salt_len = *rd.get(4)? as usize;
            let salt = rd.get(5..5 + salt_len)?;
            let hash_len = *rd.get(5 + salt_len)? as usize;
            let start = 6 + salt_len;
            let hash = rd.get(start..start + hash_len)?;
            let types = typemap(&rd[start + hash_len..])?;
            let salt = if salt.is_empty() { "-".into() } else { hex(salt, usize::MAX) };
            let mut out = format!("{alg} {flags} {iterations} {salt} {}", base32hex(hash));
            if !types.is_empty() {
                out.push(' ');
                out.push_str(&types);
            }
            Some(out)
        }
        // NSEC3PARAM: totext_nsec3param.
        51 => {
            let (alg, flags) = (*rd.first()?, *rd.get(1)?);
            let iterations = u16_at(rd, 2)?;
            let salt_len = *rd.get(4)? as usize;
            let salt = rd.get(5..5 + salt_len)?;
            if rd.len() != 5 + salt_len {
                return None;
            }
            let salt = if salt.is_empty() { "-".into() } else { hex(salt, usize::MAX) };
            Some(format!("{alg} {flags} {iterations} {salt}"))
        }
        // DNAME (hickory 0.26 doesn't parse it): totext_dname.
        39 => {
            let mut at = 0;
            let target = wire_name(rd, &mut at)?;
            (at == rd.len()).then_some(target)
        }
        _ => None,
    }
}

fn svc_key(key: SvcParamKey) -> String {
    match u16::from(key) {
        0 => "mandatory".into(),
        1 => "alpn".into(),
        2 => "no-default-alpn".into(),
        3 => "port".into(),
        4 => "ipv4hint".into(),
        5 => "ech".into(),
        6 => "ipv6hint".into(),
        n => format!("key{n}"),
    }
}

/// `multitxt_totext`: a quoted string, `\"` and `\\`, `\DDD` outside
/// printable ASCII.
fn quoted(data: &[u8]) -> String {
    let mut out = String::from("\"");
    for &c in data {
        match c {
            b'"' | b'\\' => {
                out.push('\\');
                out.push(c as char);
            }
            0x20..=0x7e => out.push(c as char),
            _ => {
                let _ = write!(out, "\\{c:03}");
            }
        }
    }
    out.push('"');
    out
}

/// `generic_totext_in_svcb`: SvcPriority, TargetName, then each SvcParam
/// as BIND prints it (`alpn="h2,h3"`, `ech=` unsplit base64, unknown keys
/// as `keyNNNNN="…"`, a key with an empty value bare).
pub fn svcb(s: &SVCB) -> String {
    let mut out = format!("{} {}", s.svc_priority, name(&s.target_name));
    for (key, value) in &s.svc_params {
        out.push(' ');
        out.push_str(&svc_key(*key));
        match value {
            SvcParamValue::Mandatory(m) => {
                let keys: Vec<String> = m.0.iter().map(|k| svc_key(*k)).collect();
                let _ = write!(out, "={}", keys.join(","));
            }
            SvcParamValue::Alpn(a) => {
                // commatxt_totext(quote: false, comma: true) per alpn-id,
                // the list in double quotes.
                out.push_str("=\"");
                for (i, id) in a.0.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    for &c in id.as_bytes() {
                        match c {
                            b',' => out.push_str("\\\\,"),
                            b'\\' => out.push_str("\\\\\\\\"),
                            b'"' => out.push_str("\\\""),
                            0x21..=0x7e => out.push(c as char),
                            _ => {
                                let _ = write!(out, "\\{c:03}");
                            }
                        }
                    }
                }
                out.push('"');
            }
            SvcParamValue::NoDefaultAlpn => {}
            SvcParamValue::Port(p) => {
                let _ = write!(out, "={p}");
            }
            SvcParamValue::Ipv4Hint(h) => {
                let ips: Vec<String> = h.0.iter().map(|a| a.0.to_string()).collect();
                let _ = write!(out, "={}", ips.join(","));
            }
            SvcParamValue::Ipv6Hint(h) => {
                let ips: Vec<String> = h.0.iter().map(|a| a.0.to_string()).collect();
                let _ = write!(out, "={}", ips.join(","));
            }
            SvcParamValue::EchConfigList(e) => {
                if !e.0.is_empty() {
                    let _ = write!(out, "={}", base64(&e.0, None));
                }
            }
            SvcParamValue::Unknown(u) => {
                if !u.0.is_empty() {
                    let _ = write!(out, "={}", quoted(&u.0));
                }
            }
        }
    }
    out
}

/// `indent()` in BIND's masterdump.c: from column `col` to column `to`
/// (at least one past `col`), with tabs to each tab stop on the way and
/// spaces after the last one.
pub fn indent(out: &mut String, col: &mut usize, to: usize) {
    let to = to.max(*col + 1);
    let tabs = to / 8 - *col / 8;
    let mut from = *col;
    if tabs > 0 {
        out.extend(std::iter::repeat_n('\t', tabs));
        from = to / 8 * 8;
    }
    out.extend(std::iter::repeat_n(' ', to - from));
    *col = to;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(name(&Name::root()), ".");
        assert_eq!(name(&Name::from_ascii("Example.COM.").unwrap()), "Example.COM.");
        let n = Name::from_labels(vec![&b"a.b"[..], &b"\x00"[..], &b"c d"[..], &b"\xff"[..]]).unwrap();
        assert_eq!(name(&n), "a\\.b.\\000.c\\032d.\\255.");
        let mut at = 0;
        assert_eq!(wire_name(b"\x01\x00\x03com\x00", &mut at).as_deref(), Some("\\000.com."));
        assert_eq!(at, 7);
        assert_eq!(wire_name(b"\x00", &mut 0).as_deref(), Some("."));
        assert_eq!(wire_name(b"\x03co", &mut 0), None);
    }

    #[test]
    fn types_and_classes() {
        assert_eq!(type_name(1), "A");
        assert_eq!(type_name(65), "HTTPS");
        assert_eq!(type_name(999), "TYPE999");
        assert_eq!(type_name(65305), "TYPE65305");
        assert_eq!(type_code("rrsig"), Some(46));
        assert_eq!(type_code("NSAP-PTR"), Some(23));
        assert_eq!(type_code("TYPE999"), Some(999));
        assert_eq!(type_code("TYPE"), None);
        assert_eq!(type_code("TYPE70000"), None);
        assert_eq!(type_code("example"), None);
        assert_eq!(class_name(1), "IN");
        assert_eq!(class_name(42), "CLASS42");
    }

    #[test]
    fn encodings() {
        assert_eq!(unknown(&[1, 2, 3, 4]), "\\# 4 01020304");
        assert_eq!(unknown(&[]), "\\# 0");
        let long: Vec<u8> = (0..32).collect();
        // 28 bytes (56 hex digits) per word, as BIND does.
        assert_eq!(
            unknown(&long),
            "\\# 32 000102030405060708090A0B0C0D0E0F101112131415161718191A1B 1C1D1E1F"
        );
        assert_eq!(base64(b"hello", None), "aGVsbG8=");
        assert_eq!(base64(b"hi", None), "aGk=");
        let key = [0x5au8; 64];
        let b = base64(&key, Some(WORD));
        let words: Vec<&str> = b.split(' ').collect();
        assert_eq!(words.iter().map(|w| w.len()).collect::<Vec<_>>(), vec![56, 32]);
        assert_eq!(base32hex(&[0xff; 5]), "VVVVVVVV");
        assert_eq!(base32hex(b"f"), "CO");
        assert_eq!(time32(1_791_301_147), "20261006153907");
        assert_eq!(time32(0), "19700101000000");
    }

    #[test]
    fn dnssec_types() {
        // cloudflare.com's KSK (key tag 2371, algorithm 13).
        let ksk = [
            &[0x01, 0x01, 0x03, 0x0d][..],
            &[
                0x99, 0xdb, 0x2c, 0xc1, 0x4c, 0xab, 0xdc, 0x33, 0xd6, 0xd7, 0x7d, 0xa6, 0x3a, 0x2f, 0x15, 0xf7,
                0x11, 0x12, 0x58, 0x4f, 0x23, 0x4e, 0x8d, 0x1d, 0xc4, 0x28, 0xe3, 0x9e, 0x8a, 0x4a, 0x97, 0xe1,
                0xaa, 0x27, 0x1a, 0x55, 0x5d, 0xc9, 0x07, 0x01, 0xe1, 0x7e, 0x2a, 0x4c, 0x4b, 0x6f, 0x12, 0x0b,
                0x7c, 0x32, 0xd4, 0x4f, 0x4a, 0xc0, 0x2b, 0xd8, 0x94, 0xcf, 0x2d, 0x4b, 0xe7, 0x77, 0x8a, 0x19,
            ][..],
        ]
        .concat();
        assert_eq!(key_tag(&ksk), 2371);
        assert_eq!(
            dnssec(48, &ksk, true).unwrap(),
            "257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+ KkxLbxILfDLUT0rAK9iUzy1L53eKGQ=="
        );
        assert_eq!(dnssec(48, &ksk, false).unwrap(), "257 3 13 [key id = 2371]");
        let ds = [&[0x09, 0x43, 13, 2][..], &[0xab; 32][..]].concat();
        assert_eq!(
            dnssec(43, &ds, true).unwrap(),
            format!("2371 13 2 {} {}", "AB".repeat(28), "AB".repeat(4))
        );
        let mut rrsig = vec![0, 1, 13, 2, 0, 0, 1, 44];
        rrsig.extend(1_791_301_147u32.to_be_bytes());
        rrsig.extend(1_791_000_000u32.to_be_bytes());
        rrsig.extend(34505u16.to_be_bytes());
        rrsig.extend(b"\x0acloudflare\x03com\x00");
        rrsig.extend([0u8; 6]);
        assert_eq!(
            dnssec(46, &rrsig, true).unwrap(),
            "A 13 2 300 20261006153907 20261003040000 34505 cloudflare.com. AAAAAAAA"
        );
        // \000.example.test. → RRSIG NSEC TYPE128 (window 0: bits 46, 47; 128).
        let mut nsec = b"\x01\x00\x07example\x04test\x00".to_vec();
        nsec.extend([0, 17]);
        nsec.extend([0u8; 5]);
        nsec.push(0x03);
        nsec.extend([0u8; 10]);
        nsec.push(0x80);
        assert_eq!(dnssec(47, &nsec, true).unwrap(), "\\000.example.test. RRSIG NSEC TYPE128");
        let mut nsec3 = vec![1, 0, 0, 10, 2, 0xaa, 0xbb, 5, 0xff, 0xff, 0xff, 0xff, 0xff];
        nsec3.extend([0, 1, 0x22]);
        assert_eq!(dnssec(50, &nsec3, true).unwrap(), "1 0 10 AABB VVVVVVVV NS SOA");
        assert_eq!(dnssec(51, &[1, 0, 0, 0, 0], true).unwrap(), "1 0 0 -");
        assert_eq!(dnssec(46, &[0, 1], true), None);
    }

    #[test]
    fn columns() {
        let line = |cols: &[(&str, usize)]| {
            let (mut out, mut col) = (String::new(), 0);
            for (i, (s, to)) in cols.iter().enumerate() {
                if i > 0 {
                    indent(&mut out, &mut col, *to);
                }
                out.push_str(s);
                col += s.len();
            }
            out
        };
        // dig's columns: TTL 24, class 32, type 40, rdata 48.
        assert_eq!(
            line(&[("example.com.", 0), ("300", 24), ("IN", 32), ("A", 40), ("192.0.2.1", 48)]),
            "example.com.\t\t300\tIN\tA\t192.0.2.1"
        );
        // An owner wider than the TTL column: spaces until a tab stop.
        assert_eq!(
            line(&[("a-very-long-owner-name-for-testing.github.io.", 0), ("3600", 24), ("IN", 32), ("A", 40), ("x", 48)]),
            "a-very-long-owner-name-for-testing.github.io. 3600 IN A\tx"
        );
        assert_eq!(
            line(&[("example.com.", 0), ("300", 24), ("IN", 32), ("NSEC3PARAM", 40), ("1 0 0 -", 48)]),
            "example.com.\t\t300\tIN\tNSEC3PARAM 1 0 0 -"
        );
    }
}
