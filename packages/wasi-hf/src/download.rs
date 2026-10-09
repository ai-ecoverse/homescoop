//! `hf download`: list a repo at one commit, then fetch its files as plain
//! files under the destination, resuming with Range and checking LFS
//! files' sha256.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::hub::{self, Hub};
use crate::util;

/// Written and fsynced in pieces, so a killed download keeps what it got.
const SYNC_EVERY: u64 = 4 << 20;
const BUFFER: usize = 1 << 20;
/// Attempts in a row without a byte of progress before a file fails.
const MAX_STALLS: u32 = 5;
const PROGRESS_EVERY: Duration = Duration::from_secs(10);

pub struct Options {
    pub repo: String,
    pub kind: String,
    pub files: Vec<String>,
    pub to: Option<String>,
    pub revision: String,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub force: bool,
    pub jobs: usize,
    pub quiet: bool,
}

#[derive(Clone, Debug)]
struct Entry {
    path: String,
    size: u64,
    sha256: Option<String>,
}

pub fn run(opts: Options, hub: Hub) -> Result<(), String> {
    let (api, prefix) = match opts.kind.as_str() {
        "model" => ("models", ""),
        "dataset" => ("datasets", "datasets/"),
        "space" => ("spaces", "spaces/"),
        other => return Err(format!("unknown --repo-type '{other}' (model, dataset or space)")),
    };
    let repo = &opts.repo;
    let base = format!("/api/{api}/{repo}");
    // Pin the commit first, so every file comes from the same one.
    let (info, _) = hub.json(&format!("{base}/revision/{}", util::encode(&opts.revision, false)))?;
    let sha = info["sha"]
        .as_str()
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| format!("no commit for {repo}@{} in the Hub's answer", opts.revision))?
        .to_string();

    let mut entries = Vec::new();
    let mut next = Some(format!("{base}/tree/{sha}?recursive=true&expand=false"));
    while let Some(url) = next {
        let (page, more) = hub.json(&url)?;
        for e in page.as_array().ok_or_else(|| format!("{url}: expected a list"))? {
            if e["type"] != "file" {
                continue;
            }
            let path = e["path"].as_str().unwrap_or_default().to_string();
            if !util::safe_relative(&path) {
                return Err(format!("refusing repo path '{path}'"));
            }
            entries.push(Entry {
                size: e["size"].as_u64().unwrap_or(0),
                sha256: lfs_sha(e),
                path,
            });
        }
        next = more;
    }

    let selected = select(&entries, &opts)?;
    let dir = match &opts.to {
        Some(to) => util::absolute(to),
        None => default_dir(&opts.kind, repo),
    };
    let total: u64 = selected.iter().map(|e| e.size).sum();
    if !opts.quiet {
        eprintln!(
            "hf: {} file(s), {} in {repo}@{} ({})",
            selected.len(),
            util::bytes(total),
            opts.revision,
            &sha[..sha.len().min(12)]
        );
    }

    let mut todo = Vec::new();
    let mut skipped = 0usize;
    for e in selected {
        let dest = dir.join(&e.path);
        if !opts.force && complete(&dest, e.size) {
            skipped += 1;
            continue;
        }
        let url = format!("{}/{prefix}{repo}/resolve/{sha}/{}", hub.endpoint, util::encode(&e.path, true));
        todo.push((e, dest, url));
    }

    let started = Instant::now();
    let queue = Arc::new(Mutex::new(todo.into_iter().rev().collect::<Vec<_>>()));
    let failed = Arc::new(AtomicBool::new(false));
    let results = Arc::new(Mutex::new((0usize, 0u64, Vec::<String>::new())));
    let workers = opts.jobs.max(1).min(queue.lock().unwrap().len().max(1));
    let quiet = opts.quiet;
    let work = {
        let (queue, failed, results, hub) = (queue.clone(), failed.clone(), results.clone(), hub.clone());
        move || loop {
            if failed.load(Ordering::SeqCst) {
                return;
            }
            let Some((entry, dest, url)) = queue.lock().unwrap().pop() else { return };
            match fetch(&hub, &url, &dest, &entry, quiet) {
                Ok(got) => {
                    let mut r = results.lock().unwrap();
                    r.0 += 1;
                    r.1 += got;
                    if !quiet {
                        eprintln!("hf: downloaded {} ({})", entry.path, util::bytes(entry.size));
                    }
                }
                Err(e) => {
                    failed.store(true, Ordering::SeqCst);
                    results.lock().unwrap().2.push(format!("failed {}: {e}", entry.path));
                    return;
                }
            }
        }
    };
    if workers == 1 {
        work();
    } else {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                let w = work.clone();
                std::thread::spawn(w)
            })
            .collect();
        for h in handles {
            let _ = h.join();
        }
    }
    let (downloaded, bytes, errors) = std::mem::take(&mut *results.lock().unwrap());
    if !errors.is_empty() {
        for e in &errors {
            eprintln!("hf: {e}");
        }
        return Err(format!("{downloaded} downloaded, {} failed", errors.len()));
    }
    if !quiet {
        let secs = started.elapsed().as_secs_f64();
        let rate = if downloaded > 0 && secs > 0.0 {
            format!(" in {secs:.1}s ({}/s)", util::bytes((bytes as f64 / secs) as u64))
        } else {
            String::new()
        };
        eprintln!(
            "hf: {downloaded} downloaded, {skipped} skipped, {} total into {}{rate}",
            util::bytes(total),
            dir.display()
        );
    }
    println!("{}", dir.display());
    Ok(())
}

/// `/home/models/<owner>/<name>` (datasets and spaces get their own folder).
/// `HF_MODELS_DIR` moves the models folder.
fn default_dir(kind: &str, repo: &str) -> PathBuf {
    let base = match kind {
        "model" => std::env::var("HF_MODELS_DIR")
            .ok()
            .filter(|d| !d.is_empty())
            .map(|d| util::absolute(&d))
            .unwrap_or_else(|| PathBuf::from("/home/models")),
        "dataset" => PathBuf::from("/home/datasets"),
        _ => PathBuf::from("/home/spaces"),
    };
    base.join(repo)
}

fn lfs_sha(e: &Value) -> Option<String> {
    let oid = e["lfs"]["oid"].as_str()?;
    let oid = oid.strip_prefix("sha256:").unwrap_or(oid).to_ascii_lowercase();
    (oid.len() == 64 && oid.bytes().all(|b| b.is_ascii_hexdigit())).then_some(oid)
}

fn select(entries: &[Entry], opts: &Options) -> Result<Vec<Entry>, String> {
    for f in &opts.files {
        let found = entries
            .iter()
            .any(|e| e.path == *f || (f.ends_with('/') && e.path.starts_with(f.as_str())));
        if !found {
            return Err(format!("{f} is not in {}@{}", opts.repo, opts.revision));
        }
    }
    Ok(entries
        .iter()
        .filter(|e| {
            opts.files.is_empty()
                || opts.files.iter().any(|f| e.path == *f || (f.ends_with('/') && e.path.starts_with(f.as_str())))
        })
        .filter(|e| opts.include.is_empty() || opts.include.iter().any(|g| util::glob(g, &e.path)))
        .filter(|e| !opts.exclude.iter().any(|g| util::glob(g, &e.path)))
        .cloned()
        .collect())
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".incomplete");
    dest.with_file_name(name)
}

/// Already here: the declared size and no unfinished download beside it.
fn complete(dest: &Path, size: u64) -> bool {
    !part_path(dest).exists() && fs::metadata(dest).map(|m| m.is_file() && m.len() == size).unwrap_or(false)
}

fn len(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// The sha256 of the first `n` bytes of a file.
fn hash_prefix(path: &Path, n: u64) -> io::Result<Sha256> {
    let mut h = Sha256::new();
    let mut f = File::open(path)?.take(n);
    let mut buf = vec![0u8; BUFFER];
    loop {
        let got = f.read(&mut buf)?;
        if got == 0 {
            return Ok(h);
        }
        h.update(&buf[..got]);
    }
}

/// Start of a `Content-Range: bytes A-B/T` answer.
fn range_start(value: Option<&str>) -> Option<u64> {
    value?.trim().strip_prefix("bytes ")?.split('-').next()?.trim().parse().ok()
}

enum Attempt {
    Done,
    Retry(String),
    Fatal(String),
}

fn fetch(hub: &Hub, url: &str, dest: &Path, entry: &Entry, quiet: bool) -> Result<u64, String> {
    let part = part_path(dest);
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    if dest.is_dir() {
        return Err(format!("{} is a directory", dest.display()));
    }
    let mut stalls = 0;
    let mut restarted = false;
    loop {
        let before = len(&part);
        let outcome = attempt(hub, url, &part, entry, quiet);
        let progressed = len(&part) != before;
        match outcome {
            Attempt::Done => {}
            Attempt::Fatal(e) => return Err(e),
            Attempt::Retry(why) => {
                stalls = if progressed { 0 } else { stalls + 1 };
                if stalls >= MAX_STALLS {
                    return Err(format!("{why}; giving up after {MAX_STALLS} tries"));
                }
                eprintln!("hf: {}: {why}; retrying", entry.path);
                if !progressed {
                    std::thread::sleep(Duration::from_secs(1 << stalls.min(4)));
                }
                continue;
            }
        }
        let got = len(&part);
        if got != entry.size {
            stalls = if progressed { 0 } else { stalls + 1 };
            if got > entry.size {
                let _ = fs::remove_file(&part);
            }
            if stalls >= MAX_STALLS {
                return Err(format!("got {got} of {} bytes; giving up", entry.size));
            }
            eprintln!("hf: {}: got {got} of {} bytes; retrying", entry.path, entry.size);
            continue;
        }
        if let Some(want) = &entry.sha256 {
            let have = hash_prefix(&part, got).map_err(|e| format!("{}: {e}", part.display()))?;
            let have: String = have.finalize().iter().map(|b| format!("{b:02x}")).collect();
            if &have != want {
                let _ = fs::remove_file(&part);
                if restarted {
                    return Err(format!("sha256 mismatch (got {have}, want {want})"));
                }
                restarted = true;
                eprintln!("hf: {}: sha256 mismatch; downloading it again from the start", entry.path);
                continue;
            }
        }
        if dest.exists() {
            let _ = fs::remove_file(dest);
        }
        fs::rename(&part, dest).map_err(|e| format!("{}: {e}", dest.display()))?;
        return Ok(got);
    }
}

fn attempt(hub: &Hub, url: &str, part: &Path, entry: &Entry, quiet: bool) -> Attempt {
    let mut have = len(part);
    if have > entry.size {
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have == entry.size && have > 0 {
        return Attempt::Done;
    }
    // identity: a CDN that would compress the answer may ignore Range.
    let mut req = hub.get(url).header("Accept-Encoding", "identity");
    if have > 0 {
        req = req.header("Range", &format!("bytes={have}-"));
    }
    let res = match req.call() {
        Ok(r) => r,
        Err(e) => return Attempt::Retry(e.to_string()),
    };
    let status = res.status();
    let resume = match status {
        200 => false,
        206 if range_start(res.header("content-range")) == Some(have) => true,
        206 => {
            let _ = fs::remove_file(part);
            return Attempt::Retry("the server answered another range".into());
        }
        416 => {
            let _ = fs::remove_file(part);
            return Attempt::Retry("the server refused the range".into());
        }
        408 | 425 | 429 | 500..=599 => return Attempt::Retry(hub::status_error(url, res)),
        _ => return Attempt::Fatal(hub::status_error(url, res)),
    };
    if have > 0 && !quiet {
        if resume {
            eprintln!("hf: {}: resuming at {}", entry.path, util::bytes(have));
        } else {
            eprintln!("hf: {}: the server ignored the range; starting again", entry.path);
        }
    }
    let file = OpenOptions::new().create(true).write(true).open(part);
    let mut file = match file {
        Ok(f) => f,
        Err(e) => return Attempt::Fatal(format!("{}: {e}", part.display())),
    };
    let start = if resume { have } else { 0 };
    if let Err(e) = file.set_len(start).and_then(|_| file.seek(SeekFrom::Start(start)).map(|_| ())) {
        return Attempt::Fatal(format!("{}: {e}", part.display()));
    }
    let mut body = res.into_reader();
    let mut buf = vec![0u8; BUFFER];
    let mut written = start;
    let mut unsynced = 0u64;
    let mut last = Instant::now();
    loop {
        let n = match body.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = file.sync_data();
                return Attempt::Retry(format!("connection lost at {}: {e}", util::bytes(written)));
            }
        };
        if let Err(e) = file.write_all(&buf[..n]) {
            return Attempt::Fatal(format!("{}: {e}", part.display()));
        }
        written += n as u64;
        unsynced += n as u64;
        if unsynced >= SYNC_EVERY {
            let _ = file.sync_data();
            unsynced = 0;
        }
        if !quiet && last.elapsed() >= PROGRESS_EVERY {
            eprintln!("hf: {}: {} of {}", entry.path, util::bytes(written), util::bytes(entry.size));
            last = Instant::now();
        }
        if written > entry.size {
            break;
        }
    }
    if let Err(e) = file.sync_all() {
        return Attempt::Fatal(format!("{}: {e}", part.display()));
    }
    Attempt::Done
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(files: &[&str], include: &[&str], exclude: &[&str]) -> Options {
        Options {
            repo: "o/r".into(),
            kind: "model".into(),
            files: files.iter().map(|s| s.to_string()).collect(),
            to: None,
            revision: "main".into(),
            include: include.iter().map(|s| s.to_string()).collect(),
            exclude: exclude.iter().map(|s| s.to_string()).collect(),
            force: false,
            jobs: 1,
            quiet: true,
        }
    }

    fn entries() -> Vec<Entry> {
        ["config.json", "onnx/model.onnx", "onnx/model_q4.onnx", "tf_model.h5"]
            .iter()
            .map(|p| Entry { path: p.to_string(), size: 1, sha256: None })
            .collect()
    }

    fn names(v: Vec<Entry>) -> Vec<String> {
        v.into_iter().map(|e| e.path).collect()
    }

    #[test]
    fn selection() {
        let e = entries();
        assert_eq!(names(select(&e, &opts(&[], &[], &["*.h5"])).unwrap()).len(), 3);
        assert_eq!(names(select(&e, &opts(&["config.json"], &[], &[])).unwrap()), ["config.json"]);
        assert_eq!(names(select(&e, &opts(&["onnx/"], &[], &["*q4*"])).unwrap()), ["onnx/model.onnx"]);
        assert_eq!(names(select(&e, &opts(&[], &["*.json", "*.h5"], &[])).unwrap()), ["config.json", "tf_model.h5"]);
        assert!(select(&e, &opts(&["missing.bin"], &[], &[])).unwrap_err().contains("missing.bin"));
    }

    #[test]
    fn lfs_and_ranges() {
        let sha = "ab".repeat(32);
        assert_eq!(lfs_sha(&serde_json::json!({"lfs": {"oid": sha}})), Some(sha.clone()));
        assert_eq!(lfs_sha(&serde_json::json!({"lfs": {"oid": format!("sha256:{sha}")}})), Some(sha));
        assert_eq!(lfs_sha(&serde_json::json!({"oid": "1234"})), None);
        assert_eq!(range_start(Some("bytes 100-199/200")), Some(100));
        assert_eq!(range_start(Some("bytes */200")), None);
        assert_eq!(part_path(Path::new("/a/b.onnx")), PathBuf::from("/a/b.onnx.incomplete"));
    }
}
