//! `hf` for slicc's kernel: the Hugging Face Hub's `hf download` and
//! `hf auth`, as a small WASI command over homescoop's wasix-net (HTTPS goes
//! in absolute form through the kernel's proxy). Not huggingface_hub's CLI.

mod auth;
mod download;
mod hub;
mod util;

use std::process::ExitCode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

const HELP: &str = "hf - download from the Hugging Face Hub (wasi-hf; a subset of huggingface_hub's hf CLI)

Usage:
  hf download <repo> [files...] [--to DIR] [--revision REV] [--include GLOB]... [--exclude GLOB]...
              [--repo-type model|dataset|space] [--force] [-j N] [--token TOKEN] [-q]
  hf auth login [--token TOKEN] [--no-verify]
  hf auth whoami
  hf auth logout
  hf version

Run `hf download --help` for the download options.
For upload, repos, cache and the rest, use huggingface_hub (pip install huggingface_hub).";

const DOWNLOAD_HELP: &str = "hf download <repo> [files...] [options]

Downloads a repo (or the named files, or folders ending in /) at one commit
into plain files under the destination. Files already there with the right
size are skipped; an interrupted file resumes from <file>.incomplete with a
Range request. LFS files are checked against their sha256.

Options:
  --to DIR, --local-dir DIR   destination (default /home/models/<owner>/<name>;
                              datasets /home/datasets/..., spaces /home/spaces/...;
                              HF_MODELS_DIR moves /home/models)
  --revision REV              branch, tag or commit (default main)
  --include GLOB              only paths matching GLOB (repeatable)
  --exclude GLOB              skip paths matching GLOB (repeatable)
  --repo-type, --type TYPE    model (default), dataset or space
  --force, --force-download   download again even if present
  -j N, --concurrency N, --max-workers N
                              files at once (default 4)
  --token TOKEN               instead of HF_TOKEN or the saved token
  -q, --quiet                 print only the destination

Environment: HF_TOKEN (then $HF_HOME/token, default ~/.cache/huggingface/token),
HF_ENDPOINT (default https://huggingface.co).";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Failure::Usage(m)) => {
            eprintln!("hf: {m}");
            eprintln!("Run `hf --help` for usage.");
            ExitCode::from(2)
        }
        Err(Failure::Error(m)) => {
            eprintln!("hf: {m}");
            ExitCode::from(1)
        }
    }
}

enum Failure {
    Usage(String),
    Error(String),
}

fn usage<T>(m: impl Into<String>) -> Result<T, Failure> {
    Err(Failure::Usage(m.into()))
}

fn run(args: Vec<String>) -> Result<(), Failure> {
    let Some(cmd) = args.first().map(String::as_str) else {
        println!("{HELP}");
        return usage("missing command");
    };
    let rest = args[1..].to_vec();
    match cmd {
        "-h" | "--help" | "help" => {
            println!("{HELP}");
            Ok(())
        }
        "-V" | "--version" | "version" => {
            println!("hf {VERSION} (@ai-ecoverse/wasi-hf: download and auth; not huggingface_hub's CLI)");
            Ok(())
        }
        "download" => download(rest),
        "auth" => auth(rest),
        "login" => auth(std::iter::once("login".to_string()).chain(rest).collect()),
        "whoami" => auth(vec!["whoami".into()]),
        "logout" => auth(vec!["logout".into()]),
        other => usage(format!(
            "'{other}' is not in this build (it has download and auth); for the full CLI, pip install huggingface_hub"
        )),
    }
}

/// `--flag value` and `--flag=value`.
struct Args {
    items: std::vec::IntoIter<String>,
}

impl Args {
    fn new(v: Vec<String>) -> Args {
        Args { items: v.into_iter() }
    }

    fn next(&mut self) -> Option<(String, Option<String>)> {
        let a = self.items.next()?;
        if a.starts_with("--") {
            if let Some((k, v)) = a.split_once('=') {
                return Some((k.to_string(), Some(v.to_string())));
            }
        }
        Some((a, None))
    }

    fn value(&mut self, flag: &str, inline: Option<String>) -> Result<String, Failure> {
        if let Some(v) = inline {
            return Ok(v);
        }
        match self.items.next() {
            Some(v) => Ok(v),
            None => usage(format!("{flag} needs a value")),
        }
    }
}

fn download(args: Vec<String>) -> Result<(), Failure> {
    let mut opts = download::Options {
        repo: String::new(),
        kind: "model".into(),
        files: vec![],
        to: None,
        revision: "main".into(),
        include: vec![],
        exclude: vec![],
        force: false,
        jobs: 4,
        quiet: false,
    };
    let mut token = None;
    let mut it = Args::new(args);
    let mut positional = vec![];
    let mut only_positional = false;
    while let Some((a, inline)) = it.next() {
        if only_positional {
            positional.push(a);
            continue;
        }
        match a.as_str() {
            "-h" | "--help" => {
                println!("{DOWNLOAD_HELP}");
                return Ok(());
            }
            "--to" | "--local-dir" => opts.to = Some(it.value(&a, inline)?),
            "--revision" | "--rev" => opts.revision = it.value(&a, inline)?,
            "--include" => opts.include.push(it.value(&a, inline)?),
            "--exclude" => opts.exclude.push(it.value(&a, inline)?),
            "--repo-type" | "--type" => opts.kind = it.value(&a, inline)?,
            "--force" | "-f" | "--force-download" => opts.force = true,
            "--token" => token = Some(it.value(&a, inline)?),
            "-q" | "--quiet" => opts.quiet = true,
            "-j" | "--concurrency" | "--max-workers" => {
                let v = it.value(&a, inline)?;
                opts.jobs = match v.parse::<usize>() {
                    Ok(n) if (1..=16).contains(&n) => n,
                    _ => return usage(format!("{a} must be 1 to 16, got '{v}'")),
                };
            }
            "--" => only_positional = true,
            s if s.starts_with('-') && s.len() > 1 => return usage(format!("unknown option {s}")),
            _ => positional.push(a),
        }
    }
    let mut positional = positional.into_iter();
    let Some(mut repo) = positional.next() else {
        return usage("hf download needs a <repo> (owner/name)");
    };
    for (prefix, kind) in [("datasets/", "dataset"), ("spaces/", "space"), ("models/", "model")] {
        if let Some(r) = repo.strip_prefix(prefix) {
            opts.kind = kind.into();
            repo = r.to_string();
        }
    }
    let valid = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)) && s != "." && s != "..";
    match repo.split_once('/') {
        Some((owner, name)) if valid(owner) && valid(name) => {}
        _ => return usage(format!("'{repo}' is not a repo id (owner/name)")),
    }
    opts.repo = repo;
    opts.files = positional.collect();
    let hub = hub::Hub::new(token.or_else(hub::token));
    download::run(opts, hub).map_err(Failure::Error)
}

fn auth(args: Vec<String>) -> Result<(), Failure> {
    let mut it = Args::new(args);
    let Some((sub, _)) = it.next() else {
        return usage("hf auth needs login, whoami or logout");
    };
    let mut token = None;
    let mut verify = true;
    while let Some((a, inline)) = it.next() {
        match a.as_str() {
            "--token" if sub == "login" => token = Some(it.value(&a, inline)?),
            "--no-verify" if sub == "login" => verify = false,
            "-h" | "--help" => {
                println!("{HELP}");
                return Ok(());
            }
            other => return usage(format!("unknown argument {other} for hf auth {sub}")),
        }
    }
    let r = match sub.as_str() {
        "login" => auth::login(token, verify),
        "logout" => auth::logout(),
        "whoami" => auth::show(),
        other => return usage(format!("unknown hf auth command '{other}' (login, whoami, logout)")),
    };
    r.map_err(Failure::Error)
}
