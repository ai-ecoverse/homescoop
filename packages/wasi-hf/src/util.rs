//! Paths, globs, URL encoding and byte formatting.

use std::path::PathBuf;

/// `path` made absolute against the process's working directory. WASI
/// programs in slicc's kernel find it in `PWD`; wasi-libc's own cwd stays `/`.
pub fn absolute(path: &str) -> PathBuf {
    if path.starts_with('/') {
        return PathBuf::from(path);
    }
    let cwd = std::env::var("PWD").unwrap_or_else(|_| "/".into());
    PathBuf::from(cwd).join(path)
}

pub fn home() -> PathBuf {
    std::env::var("HOME")
        .ok()
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home"))
}

/// Percent-encodes a URL path, keeping `/` unless `slash` is false.
pub fn encode(path: &str, slash: bool) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) || (slash && b == b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// fnmatch-style glob as huggingface_hub applies it: `*` and `?` also
/// match `/`, `[...]` is a character class, and a pattern ending in `/`
/// matches everything below that folder.
pub fn glob(pattern: &str, path: &str) -> bool {
    let pattern = if pattern.ends_with('/') { format!("{pattern}*") } else { pattern.to_string() };
    matches(pattern.as_bytes(), path.as_bytes())
}

fn matches(p: &[u8], s: &[u8]) -> bool {
    let (mut pi, mut si) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while si < s.len() {
        if pi < p.len() {
            match p[pi] {
                b'*' => {
                    star = Some(pi);
                    mark = si;
                    pi += 1;
                    continue;
                }
                b'?' => {
                    pi += 1;
                    si += 1;
                    continue;
                }
                b'[' => {
                    if let Some((hit, next)) = class(&p[pi..], s[si]) {
                        if hit {
                            pi += next;
                            si += 1;
                            continue;
                        }
                    } else if s[si] == b'[' {
                        pi += 1;
                        si += 1;
                        continue;
                    }
                }
                c if c == s[si] => {
                    pi += 1;
                    si += 1;
                    continue;
                }
                _ => {}
            }
        }
        match star {
            Some(st) => {
                pi = st + 1;
                mark += 1;
                si = mark;
            }
            None => return false,
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

/// `[...]` at the start of `p`: whether `c` is in it, and its length.
fn class(p: &[u8], c: u8) -> Option<(bool, usize)> {
    let mut i = 1;
    let negate = matches!(p.get(i), Some(b'!') | Some(b'^'));
    if negate {
        i += 1;
    }
    let mut hit = false;
    let mut first = true;
    while i < p.len() {
        if p[i] == b']' && !first {
            return Some((hit != negate, i + 1));
        }
        if i + 2 < p.len() && p[i + 1] == b'-' && p[i + 2] != b']' {
            if p[i] <= c && c <= p[i + 2] {
                hit = true;
            }
            i += 3;
        } else {
            if p[i] == c {
                hit = true;
            }
            i += 1;
        }
        first = false;
    }
    None
}

/// A repo file path that stays inside the destination folder.
pub fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && path.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut v = n as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}

/// The `rel="next"` target of a `Link` header.
pub fn next_link(link: &str) -> Option<String> {
    link.split(',').find_map(|part| {
        let (target, params) = part.split_once(';')?;
        let target = target.trim().strip_prefix('<')?.strip_suffix('>')?;
        params
            .split(';')
            .any(|p| {
                let p = p.trim();
                p == "rel=\"next\"" || p == "rel=next"
            })
            .then(|| target.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs_follow_fnmatch() {
        assert!(glob("*.json", "config.json"));
        assert!(glob("*.json", "sub/dir/config.json"));
        assert!(!glob("*.json", "config.jsonl"));
        assert!(glob("onnx/", "onnx/model.onnx"));
        assert!(!glob("onnx/", "model.onnx"));
        assert!(glob("model-?????-of-*.safetensors", "model-00001-of-00002.safetensors"));
        assert!(glob("*[0-9].bin", "shard3.bin"));
        assert!(!glob("*[!0-9].bin", "shard3.bin"));
        assert!(glob("*", "anything/at/all"));
        assert!(!glob("a*b", "acd"));
    }

    #[test]
    fn repo_paths_stay_inside() {
        assert!(safe_relative("onnx/model.onnx"));
        assert!(!safe_relative("../etc/passwd"));
        assert!(!safe_relative("/abs"));
        assert!(!safe_relative("a//b"));
        assert!(!safe_relative("a/./b"));
    }

    #[test]
    fn links_and_encoding() {
        assert_eq!(
            next_link("<https://h/api/x?cursor=abc>; rel=\"next\"").as_deref(),
            Some("https://h/api/x?cursor=abc")
        );
        assert_eq!(next_link("<https://h/p>; rel=\"prev\""), None);
        assert_eq!(encode("refs/pr/1", false), "refs%2Fpr%2F1");
        assert_eq!(encode("a b/c+d.json", true), "a%20b/c%2Bd.json");
        assert_eq!(bytes(512), "512 B");
        assert_eq!(bytes(1536), "1.5 KiB");
    }
}
